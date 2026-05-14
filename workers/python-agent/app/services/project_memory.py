"""Project Memory service — per-project knowledge graph.

1-to-1 with the `projects` row. Accumulates:
  - entities      : extracted nouns/products/tools/people mentioned across chat + prompts
  - decisions     : design/scope decisions (audience locked, palette chosen, etc.)
  - outlines      : prior outlines from successful jobs (jobId + slide titles/summaries)
  - edits         : surgical-edit log (instruction + targets)
  - preferences   : inferred user prefs (engine, creativeMode, ...)
  - narrative     : LLM-rolled prose summary the agent prompt prepends

Every engine reads `get_context()`; the worker writes via `record_*` after each
successful generation/edit. Narrative is re-summarized periodically.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import structlog
import psycopg

from app.config import settings

logger = structlog.get_logger()

# Re-summarize the narrative every N writes. Keeps the rolling summary fresh
# without blowing through tokens on every tiny write.
NARRATIVE_REFRESH_EVERY = 5

# Cap on serialized memory length the agent receives. Beyond this we start
# truncating older outlines/edits before summarization picks them up.
MAX_CONTEXT_CHARS = 6000


class ProjectMemoryService:
    """Manages the per-project knowledge graph row in PostgreSQL."""

    def __init__(self, project_id: str) -> None:
        if not project_id:
            raise ValueError("project_id is required")
        self.project_id = project_id

    def _conn(self) -> psycopg.Connection:
        return psycopg.connect(settings.database_url)

    # ── Read side ────────────────────────────────────────────────────────

    def _load_or_init(self) -> dict:
        """Fetch the memory row; create an empty one if it doesn't exist."""
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT entities, decisions, outlines, edits, preferences, narrative, version
                    FROM project_memory
                    WHERE "projectId" = %s
                    """,
                    (self.project_id,),
                )
                row = cur.fetchone()
                if row:
                    return {
                        "entities": row[0] or [],
                        "decisions": row[1] or [],
                        "outlines": row[2] or [],
                        "edits": row[3] or [],
                        "preferences": row[4] or {},
                        "narrative": row[5] or "",
                        "version": row[6] or 0,
                    }

                # Create empty row so subsequent writes can update.
                cur.execute(
                    """
                    INSERT INTO project_memory (id, "projectId", "createdAt", "updatedAt")
                    VALUES (gen_random_uuid()::text, %s, NOW(), NOW())
                    ON CONFLICT ("projectId") DO NOTHING
                    """,
                    (self.project_id,),
                )
                conn.commit()
                return {
                    "entities": [],
                    "decisions": [],
                    "outlines": [],
                    "edits": [],
                    "preferences": {},
                    "narrative": "",
                    "version": 0,
                }

    def get_context(self) -> str:
        """Render the memory as a markdown brief the agent prompt prepends.

        Returns empty string if the project has no accumulated memory yet —
        callers should check `if context:` to skip injection on cold start.
        """
        mem = self._load_or_init()

        # Cold start — nothing useful to inject yet.
        empty = (
            not mem["entities"]
            and not mem["decisions"]
            and not mem["outlines"]
            and not mem["edits"]
            and not mem["narrative"]
        )
        if empty:
            return ""

        out: list[str] = ["# Project Memory", ""]

        if mem["narrative"]:
            out.append("## Summary")
            out.append(mem["narrative"].strip())
            out.append("")

        if mem["preferences"]:
            out.append("## Preferences")
            for k, v in mem["preferences"].items():
                out.append(f"- {k}: {v}")
            out.append("")

        if mem["entities"]:
            out.append("## Key entities mentioned")
            # Highest-mention first, cap at 12
            sorted_ents = sorted(
                mem["entities"], key=lambda e: e.get("mentions", 1), reverse=True
            )[:12]
            for ent in sorted_ents:
                kind = ent.get("kind", "")
                kind_str = f" ({kind})" if kind else ""
                out.append(f"- **{ent['label']}**{kind_str}")
            out.append("")

        if mem["decisions"]:
            out.append("## Decisions made so far")
            # Most recent 8
            for d in mem["decisions"][-8:]:
                why = f" — {d['why']}" if d.get("why") else ""
                out.append(f"- {d['what']}{why}")
            out.append("")

        if mem["outlines"]:
            out.append("## Prior decks for this project")
            # Most recent 3 outlines, with up to 6 slides each
            for o in mem["outlines"][-3:]:
                when = o.get("generatedAt", "")
                out.append(f"### Deck generated {when}")
                for s in (o.get("slides") or [])[:6]:
                    title = s.get("title", "(untitled)")
                    summary = s.get("summary", "")
                    out.append(f"- {title}" + (f" — {summary}" if summary else ""))
                out.append("")

        if mem["edits"]:
            out.append("## Recent edits")
            for e in mem["edits"][-5:]:
                targets = e.get("targetSlides", []) or []
                targets_str = (
                    f" (slides {', '.join(map(str, targets))})" if targets else ""
                )
                out.append(f"- {e['instruction']}{targets_str}")
            out.append("")

        rendered = "\n".join(out)
        # Hard cap so we don't blow the prompt budget on huge projects.
        if len(rendered) > MAX_CONTEXT_CHARS:
            rendered = rendered[:MAX_CONTEXT_CHARS] + "\n…(memory truncated)\n"
        return rendered

    # ── Write side ───────────────────────────────────────────────────────

    def _update(self, **fields: Any) -> int:
        """Apply a partial update to the row. Increments version. Returns new version.

        Fields may include any of: entities, decisions, outlines, edits,
        preferences, narrative. JSON fields are serialized here.
        """
        mem = self._load_or_init()  # ensures row exists

        cols: list[str] = []
        vals: list[Any] = []
        for k, v in fields.items():
            if k in ("entities", "decisions", "outlines", "edits", "preferences"):
                cols.append(f'"{k}" = %s')
                vals.append(json.dumps(v))
            elif k == "narrative":
                cols.append('"narrative" = %s')
                vals.append(v)
            else:
                raise ValueError(f"Unknown memory field: {k}")

        new_version = mem["version"] + 1
        cols.append('"version" = %s')
        vals.append(new_version)
        cols.append('"updatedAt" = NOW()')

        vals.append(self.project_id)
        sql = f'UPDATE project_memory SET {", ".join(cols)} WHERE "projectId" = %s'

        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, vals)
                conn.commit()
        return new_version

    def record_outline(
        self,
        job_id: str,
        outline: list[dict],
        engine: str | None = None,
    ) -> int:
        """Append an outline produced by a successful job. Returns new version."""
        mem = self._load_or_init()
        outlines = list(mem["outlines"])

        # Compact slides: title + 1-line summary only. The full outline lives
        # in the Presentation row.
        slides_compact = []
        for s in outline:
            slides_compact.append(
                {
                    "title": s.get("title") or s.get("slide_title") or "(untitled)",
                    "summary": (s.get("summary") or s.get("description") or "")[:200],
                }
            )

        outlines.append(
            {
                "jobId": job_id,
                "engine": engine,
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "slides": slides_compact,
            }
        )

        # Keep at most 10 outlines — older ones get folded into narrative.
        if len(outlines) > 10:
            outlines = outlines[-10:]

        version = self._update(outlines=outlines)
        logger.info(
            "memory_outline_recorded",
            project_id=self.project_id,
            job_id=job_id,
            slide_count=len(slides_compact),
            version=version,
        )
        return version

    def record_edit(
        self,
        instruction: str,
        target_slides: list[int] | None = None,
        job_id: str | None = None,
    ) -> int:
        mem = self._load_or_init()
        edits = list(mem["edits"])
        edits.append(
            {
                "instruction": instruction,
                "targetSlides": target_slides or [],
                "jobId": job_id,
                "at": datetime.now(timezone.utc).isoformat(),
            }
        )
        if len(edits) > 20:
            edits = edits[-20:]
        version = self._update(edits=edits)
        logger.info(
            "memory_edit_recorded",
            project_id=self.project_id,
            version=version,
        )
        return version

    def record_decision(self, what: str, why: str = "") -> int:
        mem = self._load_or_init()
        decisions = list(mem["decisions"])
        decisions.append(
            {
                "what": what,
                "why": why,
                "at": datetime.now(timezone.utc).isoformat(),
            }
        )
        if len(decisions) > 30:
            decisions = decisions[-30:]
        return self._update(decisions=decisions)

    def merge_entities(self, new_entities: list[dict]) -> int:
        """Merge newly-extracted entities into the existing list.

        Each entity: { label, kind, mentions }. Labels are matched case-insensitively;
        mentions are summed when a match is found.
        """
        if not new_entities:
            return self._load_or_init()["version"]

        mem = self._load_or_init()
        existing = list(mem["entities"])
        index = {e["label"].lower(): i for i, e in enumerate(existing) if e.get("label")}

        for ent in new_entities:
            label = (ent.get("label") or "").strip()
            if not label:
                continue
            lk = label.lower()
            inc = int(ent.get("mentions", 1) or 1)
            if lk in index:
                row = existing[index[lk]]
                row["mentions"] = int(row.get("mentions", 1) or 1) + inc
                # Last-write-wins for kind if it was previously empty.
                if not row.get("kind") and ent.get("kind"):
                    row["kind"] = ent["kind"]
            else:
                existing.append(
                    {
                        "label": label,
                        "kind": (ent.get("kind") or "").strip(),
                        "mentions": inc,
                    }
                )
                index[lk] = len(existing) - 1

        # Cap to top 60 by mentions; long tail isn't useful in prompts.
        existing.sort(key=lambda e: e.get("mentions", 1), reverse=True)
        existing = existing[:60]
        return self._update(entities=existing)

    def update_preferences(self, prefs: dict) -> int:
        if not prefs:
            return self._load_or_init()["version"]
        mem = self._load_or_init()
        merged = {**(mem["preferences"] or {}), **prefs}
        return self._update(preferences=merged)

    def maybe_refresh_narrative(
        self,
        llm_call: Any | None = None,
        force: bool = False,
    ) -> int | None:
        """Re-roll the narrative summary if version has advanced enough.

        `llm_call` is a callable(prompt: str) -> str. If not provided, this is
        a no-op (callers without an LLM available can still write to memory,
        the narrative just stays stale until the next caller).
        """
        mem = self._load_or_init()
        if not force and mem["version"] % NARRATIVE_REFRESH_EVERY != 0:
            return None
        if mem["version"] == 0:
            return None
        if llm_call is None:
            return None

        # Build a compact dump of everything the LLM should summarize.
        dump_parts: list[str] = []
        if mem["entities"]:
            top_ents = sorted(
                mem["entities"], key=lambda e: e.get("mentions", 1), reverse=True
            )[:20]
            dump_parts.append("Entities: " + ", ".join(e["label"] for e in top_ents))
        if mem["decisions"]:
            dump_parts.append(
                "Decisions:\n"
                + "\n".join(f"- {d['what']}" for d in mem["decisions"][-20:])
            )
        if mem["outlines"]:
            recent = mem["outlines"][-5:]
            for o in recent:
                titles = ", ".join((s.get("title") or "") for s in o.get("slides", []))
                dump_parts.append(f"Outline {o.get('generatedAt', '')}: {titles}")
        if mem["edits"]:
            dump_parts.append(
                "Edits:\n"
                + "\n".join(f"- {e['instruction']}" for e in mem["edits"][-10:])
            )

        if not dump_parts:
            return None

        prompt = (
            "You are maintaining a rolling project memory for a presentation-generation agent. "
            "Below is the raw structured memory. Produce a concise prose summary (max 6 sentences, "
            "~1500 chars) that captures the project's topic, audience, key decisions, recurring "
            "entities, and any patterns in edits. Write it so a new agent could read it once and "
            "know how to behave consistently.\n\n"
            + "\n\n".join(dump_parts)
            + "\n\nWrite the summary now (prose, no headings)."
        )
        try:
            narrative = (llm_call(prompt) or "").strip()
        except Exception as e:
            logger.warning(
                "memory_narrative_refresh_failed",
                project_id=self.project_id,
                error=str(e),
            )
            return None

        if not narrative:
            return None
        if len(narrative) > 2000:
            narrative = narrative[:2000] + "…"
        return self._update(narrative=narrative)
