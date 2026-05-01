"""Hybrid slide search: lexical (tsv) + semantic (BGE) + visual (CLIP), fused with RRF."""
from __future__ import annotations

import re
from typing import Any

import psycopg
import structlog
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row

from app.config import settings
from app.services.find_indexer import embed_text, embed_clip_text

logger = structlog.get_logger()

# Color words → rough hex centers used for the "red blocks" boost.
COLOR_KEYWORDS: dict[str, str] = {
    "red": "#d62828",
    "orange": "#f77f00",
    "yellow": "#fcbf49",
    "green": "#52b788",
    "teal": "#2a9d8f",
    "blue": "#1d4ed8",
    "navy": "#0b3d91",
    "purple": "#7b2cbf",
    "pink": "#e63946",
    "black": "#111111",
    "white": "#ffffff",
    "gray": "#6b7280",
    "grey": "#6b7280",
    "brown": "#7c4d2c",
}


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _color_distance(a: str, b: str) -> float:
    ar, ag, ab = _hex_to_rgb(a)
    br, bg, bb = _hex_to_rgb(b)
    # Euclidean RGB distance, normalized to 0..1
    d = ((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2) ** 0.5
    return d / 441.67  # max distance √(255²·3)


def _color_keywords_in_query(q: str) -> list[str]:
    q_low = q.lower()
    return [c for c in COLOR_KEYWORDS if re.search(rf"\b{c}\b", q_low)]


def search(
    *,
    user_id: str,
    query: str,
    limit: int = 24,
) -> list[dict[str, Any]]:
    """Hybrid search across the user's indexed slides. Returns top-N with rich metadata."""
    query = query.strip()
    if not query:
        return []

    log = logger.bind(user_id=user_id, query=query[:80])
    log.info("search_start")

    # Embed the query for both text and visual lanes.
    q_text_emb = embed_text([query])[0].tolist()
    q_clip_emb = embed_clip_text(query).tolist()

    candidate_pool = max(limit * 4, 60)

    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        register_vector(conn)
        with conn.cursor() as cur:
            # Lane 1: lexical full-text
            cur.execute(
                """
                SELECT s.id, ts_rank(s.text_tsv, websearch_to_tsquery('english', %s)) AS score
                FROM slide_index s
                WHERE s."userId" = %s
                  AND s.text_tsv @@ websearch_to_tsquery('english', %s)
                ORDER BY score DESC
                LIMIT %s
                """,
                (query, user_id, query, candidate_pool),
            )
            lex_rows = cur.fetchall()

            # Lane 2: semantic text vector (cosine)
            cur.execute(
                """
                SELECT s.id, 1 - (s.text_embedding <=> %s::vector) AS score
                FROM slide_index s
                WHERE s."userId" = %s AND s.text_embedding IS NOT NULL
                ORDER BY s.text_embedding <=> %s::vector
                LIMIT %s
                """,
                (q_text_emb, user_id, q_text_emb, candidate_pool),
            )
            sem_rows = cur.fetchall()

            # Lane 3: visual CLIP vector
            cur.execute(
                """
                SELECT s.id, 1 - (s.image_embedding <=> %s::vector) AS score
                FROM slide_index s
                WHERE s."userId" = %s AND s.image_embedding IS NOT NULL
                ORDER BY s.image_embedding <=> %s::vector
                LIMIT %s
                """,
                (q_clip_emb, user_id, q_clip_emb, candidate_pool),
            )
            vis_rows = cur.fetchall()

            # ── RRF ──
            rrf_k = 60
            scores: dict[str, float] = {}

            for rank, row in enumerate(lex_rows):
                scores[row["id"]] = scores.get(row["id"], 0.0) + 1.0 / (rrf_k + rank)
            for rank, row in enumerate(sem_rows):
                scores[row["id"]] = scores.get(row["id"], 0.0) + 1.0 / (rrf_k + rank)
            for rank, row in enumerate(vis_rows):
                scores[row["id"]] = scores.get(row["id"], 0.0) + 1.0 / (rrf_k + rank)

            if not scores:
                log.info("search_no_results")
                return []

            # Color boost: if query mentions color words, give a small bump to slides
            # whose dominant color palette is close to that color.
            color_kws = _color_keywords_in_query(query)
            if color_kws:
                cur.execute(
                    """
                    SELECT id, dominant_colors FROM slide_index
                    WHERE id = ANY(%s::uuid[])
                    """,
                    (list(scores.keys()),),
                )
                for row in cur.fetchall():
                    palette = row["dominant_colors"] or []
                    best_match = 0.0
                    for kw in color_kws:
                        kw_hex = COLOR_KEYWORDS[kw]
                        for entry in palette:
                            if not isinstance(entry, dict):
                                continue
                            d = _color_distance(kw_hex, entry.get("hex", "#888888"))
                            similarity = max(0.0, 1.0 - d)
                            best_match = max(best_match, similarity * float(entry.get("weight", 0.0)))
                    # Boost magnitude tuned to be roughly comparable to RRF top-10 contributions.
                    scores[row["id"]] += best_match * 0.02

            # Pick top-N by score
            top_ids = sorted(scores.keys(), key=lambda i: scores[i], reverse=True)[:limit]

            # Hydrate
            cur.execute(
                """
                SELECT
                    s.id, s."slideNumber", s."thumbnailS3Key",
                    s."slideText", s."ocrText", s.dominant_colors,
                    sf.id AS source_file_id, sf."fileName", sf."s3Key" AS source_s3_key
                FROM slide_index s
                JOIN source_files sf ON sf.id = s."sourceFileId"
                WHERE s.id = ANY(%s::uuid[])
                """,
                (top_ids,),
            )
            rows_by_id = {r["id"]: r for r in cur.fetchall()}

            results: list[dict[str, Any]] = []
            for rank, sid in enumerate(top_ids, start=1):
                r = rows_by_id.get(sid)
                if not r:
                    continue
                snippet = (r["slideText"] or r["ocrText"] or "").strip()
                if len(snippet) > 240:
                    snippet = snippet[:240].rsplit(" ", 1)[0] + "…"
                results.append({
                    "id": str(sid),
                    "rank": rank,
                    "score": round(scores[sid], 6),
                    "slide_number": r["slideNumber"],
                    "thumbnail_s3_key": r["thumbnailS3Key"],
                    "snippet": snippet,
                    "source_file_id": r["source_file_id"],
                    "source_file_name": r["fileName"],
                    "dominant_colors": r["dominant_colors"],
                })

    log.info("search_done", lex=len(lex_rows), sem=len(sem_rows), vis=len(vis_rows), returned=len(results))
    return results
