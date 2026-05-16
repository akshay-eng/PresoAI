from __future__ import annotations

import json
import os
from typing import Any

import aiohttp
import structlog
from bullmq import Worker, Queue

from app.config import settings
from app.agents.graph import run_graph
from app.models import PPTGenerationState
from app.services.progress import ProgressPublisher

logger = structlog.get_logger()


def _get_redis_opts() -> dict:
    redis_url = settings.redis_url
    parsed = redis_url.replace("redis://", "").split(":")
    host = parsed[0] if parsed else "localhost"
    port = int(parsed[1]) if len(parsed) > 1 else 6379
    return {"host": host, "port": port}


async def process_python_agent_job(job: Any, token: str | None = None) -> dict:
    job_data = job.data if hasattr(job, "data") else job
    job_id = job_data.get("jobId", "unknown")
    project_id = job_data.get("projectId", "")
    publisher = ProgressPublisher(job_id)

    # Edit-mode jobs skip the full langgraph and patch existing slides only.
    if job_data.get("mode") == "edit":
        return await _process_edit_job(job_data, publisher)

    try:
        await publisher.publish("starting", 0.0, "Starting AI agent pipeline...")

        # Style profile theme has priority over the bare templateThemeConfig sent
        # by the API (the API's `themeConfig` field is meant for the renderer's
        # post-pass theme1.xml injection — slide content should still see the
        # profile's colors directly so the LLM can pin every accent).
        seed_theme = job_data.get("profileThemeConfig") or job_data.get("themeConfig") or {}

        # Per-project knowledge-graph context — pulled once at job start.
        # Built from prior outlines/edits/decisions/entities/narrative for this
        # project. Empty string on cold start (first job for the project).
        project_context = ""
        if project_id:
            try:
                from app.services.project_memory import ProjectMemoryService
                project_context = ProjectMemoryService(project_id).get_context()
                if project_context:
                    logger.info(
                        "project_memory_loaded",
                        project_id=project_id,
                        context_chars=len(project_context),
                    )
            except Exception as e:
                # Memory is best-effort — never block a job on a memory read.
                logger.warning(
                    "project_memory_read_failed",
                    project_id=project_id,
                    error=str(e),
                )

        initial_state: PPTGenerationState = {
            "user_prompt": job_data.get("prompt", ""),
            "num_slides": job_data.get("numSlides", 10),
            "audience_type": job_data.get("audienceType", "general"),
            "template_s3_key": job_data.get("templateS3Key", ""),
            "reference_file_keys": job_data.get("referenceFileKeys", []),
            "selected_model": job_data.get("selectedModel", {}),
            "job_id": job_id,
            "research_results": [],
            "messages": [],
            "user_id": job_data.get("userId", ""),
            "theme_config": seed_theme,
            "style_guide": job_data.get("styleGuide", ""),
            "visual_style": job_data.get("visualStyle", {}),
            "layout_patterns": job_data.get("layoutPatterns", []),
            "creative_mode": job_data.get("creativeMode", False),
            "use_diagram_images": job_data.get("useDiagramImages", False),
            "use_image_gen": job_data.get("useImageGen", False),
            "chat_image_keys": job_data.get("chatImageKeys", []),
            "reference_visual_parts": [],
            "project_context": project_context,
            "project_id": project_id,
        }

        thread_id = job_data.get("langGraphThreadId", job_id)

        logger.info("starting_graph", job_id=job_id, thread_id=thread_id)
        final_state = await run_graph(initial_state, thread_id)

        if final_state.get("error"):
            await publisher.publish("failed", 1.0, f"Failed: {final_state['error']}")
            await publisher.close()
            raise Exception(final_state["error"])

        slides = final_state.get("slides", [])
        theme_config = final_state.get("theme_config", {})

        # Merge with theme from job data (template or style profile theme)
        incoming_theme = job_data.get("themeConfig", {})
        if incoming_theme and not theme_config:
            theme_config = incoming_theme

        logger.info("graph_completed", job_id=job_id, slide_count=len(slides))

        engine = job_data.get("engine", "claude-code")
        logger.info("engine_selected", engine=engine, job_id=job_id)

        # Get knowledge graph context
        kg_context = ""
        user_id = job_data.get("userId", "")
        if user_id:
            try:
                from app.services.knowledge_graph import KnowledgeGraphService
                kg = KnowledgeGraphService(user_id)
                kg_context = kg.get_design_context()
            except Exception:
                pass

        s3_key = ""
        slide_count = 0

        if engine == "preso-pro":
            # ── Preso Pro engine — shape-kit-based marketing generator ──
            await publisher.publish(
                "preso_pro_dispatch", 0.55,
                "Routing to Preso Pro engine...",
            )
            from app.preso_pro import generate_preso_pro_deck
            preso_result = await generate_preso_pro_deck(
                final_state,
                project_id=project_id,
                job_id=job_id,
                user_id=job_data.get("userId", ""),
                project_name=job_data.get("projectName", "Presentation"),
            )
            s3_key = preso_result["s3_key"]
            slide_count = preso_result["slide_count"]
            logger.info("preso_pro_completed", job_id=job_id, s3_key=s3_key, slide_count=slide_count)

        elif engine in ("claude-code", "preso-plus"):
            # ── Claude Code Agent path (Anthropic or Gemini via proxy) ──
            # `preso-plus` routes Claude Code through the open-source
            # Anthropic→Gemini proxy so no Anthropic key is needed.
            use_gemini = engine == "preso-plus"
            provider_label = "Gemini via proxy" if use_gemini else "Anthropic"
            await publisher.publish(
                "agent_complete", 0.88,
                f"Sending to Claude Code ({provider_label}) design agent ({len(final_state.get('outline', []))} slides)...",
            )

            pptx_agent_url = os.environ.get("PPTX_AGENT_URL", "http://localhost:8100")
            pptx_request = {
                "prompt": job_data.get("prompt", ""),
                "numSlides": job_data.get("numSlides", 5),
                "audience": job_data.get("audienceType", "technical"),
                "outline": final_state.get("outline", []),
                "researchSummary": final_state.get("research_summary", ""),
                "styleGuide": job_data.get("styleGuide", ""),
                "knowledgeGraphContext": kg_context,
                # Per-project memory — prior outlines/decisions/entities/narrative.
                # pptx-agent prepends this to the Claude Code prompt so the
                # agent stays consistent across turns for the same project.
                "projectMemoryContext": project_context,
                "projectId": project_id,
                "jobId": job_id,
                "useGemini": use_gemini,
            }

            async with aiohttp.ClientSession() as http_session:
                async with http_session.post(
                    f"{pptx_agent_url}/generate",
                    json=pptx_request,
                    timeout=aiohttp.ClientTimeout(total=300),
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        raise Exception(f"PPTX Claude Code agent failed: {error_text}")
                    pptx_result = await resp.json()

            s3_key = pptx_result.get("s3Key", "")
            slide_count = pptx_result.get("slideCount", 0)
            logger.info("claude_code_agent_completed", job_id=job_id, s3_key=s3_key)

        else:
            # ── Node Worker path (legacy) ──
            await publisher.publish(
                "agent_complete", 0.88,
                f"Sending {len(slides)} slides to Node worker...",
            )

            node_worker_queue = Queue(
                "ppt-node-worker",
                {"connection": _get_redis_opts()},
            )
            node_job_data = {
                "projectId": project_id,
                "jobId": job_id,
                "slides": slides,
                "themeConfig": theme_config,
                "numSlides": len(slides),
                "projectName": job_data.get("projectName", "Presentation"),
                # Per-project memory passes through to the node-worker so any
                # post-pass LLM calls (titling, naming, etc.) stay context-aware.
                "projectMemoryContext": project_context,
            }
            await node_worker_queue.add("generate-pptx", node_job_data)
            await node_worker_queue.close()
            logger.info("node_worker_job_enqueued", job_id=job_id)

            # Write outline to project memory before returning. The node-worker
            # owns DB updates from here, but it doesn't know about memory.
            if project_id:
                try:
                    from app.services.project_memory import ProjectMemoryService
                    ProjectMemoryService(project_id).record_outline(
                        job_id=job_id,
                        outline=final_state.get("outline", []),
                        engine=engine,
                    )
                except Exception as mem_err:
                    logger.warning(
                        "project_memory_writeback_failed",
                        job_id=job_id,
                        project_id=project_id,
                        error=str(mem_err),
                    )

            # The node worker handles DB updates and S3 upload itself
            await publisher.close()
            return {"slides": slides, "themeConfig": theme_config}

        # Save presentation record to DB
        try:
            import psycopg
            with psycopg.connect(settings.database_url) as conn:
                with conn.cursor() as cur:
                    # Project may have been deleted by the user mid-job. If so,
                    # the FK insert below would crash and leave the job in a
                    # weird state. Bail cleanly instead — mark the job as
                    # failed and skip the presentation write.
                    cur.execute('SELECT 1 FROM projects WHERE id = %s', (project_id,))
                    if not cur.fetchone():
                        logger.warning(
                            "project_deleted_mid_job",
                            job_id=job_id,
                            project_id=project_id,
                            s3_key=s3_key,
                        )
                        cur.execute(
                            """UPDATE jobs SET status = 'FAILED', progress = 1.0,
                               "currentPhase" = 'failed',
                               error = 'Project was deleted before generation finished',
                               "completedAt" = NOW() WHERE id = %s""",
                            (job_id,),
                        )
                        conn.commit()
                        await publisher.publish(
                            "failed", 1.0,
                            "Project was deleted before generation finished.",
                        )
                        await publisher.close()
                        return {"s3Key": s3_key, "slideCount": slide_count}

                    # Count existing versions
                    cur.execute('SELECT COUNT(*) FROM presentations WHERE "projectId" = %s', (project_id,))
                    version = (cur.fetchone()[0] or 0) + 1

                    # Snapshot the slide source for the edit agent. slide_writer
                    # ran upstream (regardless of engine) and produced these
                    # specs, so even Preso Plus / Claude Code decks can be
                    # surgically edited. Edits re-render via Preso Elite — the
                    # user keeps their iteration loop instead of being told
                    # "regenerate the whole deck to enable edits".
                    slides_for_edit = final_state.get("slides", []) or []
                    theme_snapshot = {
                        "themeConfig": theme_config or {},
                        "engine": engine,
                    }

                    # Thumbnail keys returned by pptx-agent (or empty for engines
                    # that don't render them yet).
                    thumb_keys = pptx_result.get("thumbnailKeys", []) if engine in (
                        "claude-code", "preso-plus"
                    ) else []

                    # Create presentation record. slidesData + themeSnapshot let
                    # the edit endpoint find the source code; thumbnails populate
                    # the gallery on the dashboard / project page.
                    cur.execute(
                        """INSERT INTO presentations
                              (id, "projectId", title, "s3Key", "slideCount", version,
                               "slidesData", "themeSnapshot", thumbnails,
                               "createdAt", "updatedAt")
                           VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s,
                                   %s::jsonb, %s::jsonb, %s::jsonb, NOW(), NOW())
                           RETURNING id""",
                        (
                            project_id,
                            job_data.get("projectName", "Presentation"),
                            s3_key,
                            slide_count,
                            version,
                            json.dumps(slides_for_edit),
                            json.dumps(theme_snapshot),
                            json.dumps(thumb_keys),
                        ),
                    )
                    pres_id = cur.fetchone()[0]

                    # Update job
                    cur.execute(
                        """UPDATE jobs SET status = 'COMPLETED', progress = 1.0, "currentPhase" = 'complete',
                        output = %s, "completedAt" = NOW() WHERE id = %s""",
                        (json.dumps({"s3Key": s3_key, "slideCount": slide_count, "presentationId": pres_id}), job_id),
                    )
                    conn.commit()
                    logger.info(
                        "db_updated",
                        job_id=job_id,
                        presentation_id=pres_id,
                        slides_persisted=len(slides_for_edit),
                        thumbs=len(thumb_keys),
                    )
        except Exception as db_err:
            logger.error("db_update_failed", error=str(db_err))

        # ── Write-back to per-project memory ──
        # Records the outline so future jobs in this project know what was
        # generated before. Best-effort — a write failure must not fail the job.
        if project_id:
            try:
                from app.services.project_memory import ProjectMemoryService
                pm = ProjectMemoryService(project_id)
                pm.record_outline(
                    job_id=job_id,
                    outline=final_state.get("outline", []),
                    engine=engine,
                )
                # Roll the narrative if version threshold hit. We don't have
                # an LLM ready here — pass None to skip; narrative refresh will
                # happen the next time the user requests it via the API.
                pm.maybe_refresh_narrative(llm_call=None)
            except Exception as mem_err:
                logger.warning(
                    "project_memory_writeback_failed",
                    job_id=job_id,
                    project_id=project_id,
                    error=str(mem_err),
                )

        await publisher.publish("complete", 1.0, "Presentation ready!", data={"s3Key": s3_key, "slideCount": slide_count})
        await publisher.close()

        return {"s3Key": s3_key, "slideCount": slide_count}

    except Exception as e:
        from app.services.error_classifier import classify, to_payload
        classified = classify(e)
        logger.error(
            "job_failed",
            job_id=job_id,
            error=str(e),
            code=classified.code,
            provider=classified.provider,
        )
        # If BullMQ will retry this job, don't tell the UI it has failed —
        # the next attempt would otherwise leave the user staring at a stale
        # "Job failed" panel even after the retry succeeds. Only publish a
        # terminal "failed" event when this was the LAST attempt.
        is_last_attempt = True
        try:
            attempts_made = int(getattr(job, "attemptsMade", 0) or 0) + 1
            max_attempts = int((job.opts or {}).get("attempts", 1)) if hasattr(job, "opts") else 1
            is_last_attempt = attempts_made >= max_attempts
        except Exception:
            pass

        # Non-retryable errors (billing, auth, etc.) shouldn't burn additional
        # BullMQ attempts — surface them to the user immediately.
        if is_last_attempt or not classified.retryable:
            await publisher.publish(
                "failed",
                1.0,
                classified.title + " — " + classified.message,
                data=to_payload(classified),
            )
            # Persist the structured error onto the jobs row so the active-job
            # endpoint can re-surface it after a refresh.
            try:
                import psycopg
                with psycopg.connect(settings.database_url) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """UPDATE jobs
                                  SET status = 'FAILED',
                                      "currentPhase" = 'failed',
                                      error = %s,
                                      output = %s,
                                      "completedAt" = NOW(),
                                      "updatedAt" = NOW()
                                WHERE id = %s""",
                            (
                                f"[{classified.code}] {classified.title}: {classified.message}",
                                json.dumps(to_payload(classified)),
                                job_id,
                            ),
                        )
                        conn.commit()
            except Exception as db_err:
                logger.warning("job_error_persist_failed", error=str(db_err))
        else:
            # Soft retry: keep the pipeline visible as still-in-flight.
            await publisher.publish(
                "retrying",
                0.5,
                f"Hit a transient error, retrying… ({classified.title})",
            )
        await publisher.close()
        # Non-retryable: don't re-raise (would trigger BullMQ retries that
        # burn attempts on a definitely-doomed payload). Retryable: re-raise
        # so BullMQ can try again.
        if classified.retryable and not is_last_attempt:
            raise
        return {"error": classified.code, "title": classified.title}


async def _process_edit_job(job_data: dict, publisher: ProgressPublisher) -> dict:
    """Handle a surgical-edit job. Loads existing slides, asks the edit
    agent for patched slides, dispatches to the node-worker for re-render."""
    job_id = job_data.get("jobId", "unknown")
    project_id = job_data.get("projectId", "")

    try:
        await publisher.publish("starting", 0.05, "Loading existing slides...")

        existing_slides = job_data.get("existingSlides") or []
        instruction = job_data.get("instruction", "")
        target_slides = job_data.get("targetSlides") or None
        theme_config = job_data.get("themeConfig") or {}
        style_guide = job_data.get("styleGuide", "")
        visual_style = job_data.get("visualStyle") or {}
        selected_model = job_data.get("selectedModel") or {}

        if not existing_slides:
            raise Exception("Edit job is missing existingSlides — nothing to patch.")
        if not instruction.strip():
            raise Exception("Edit job is missing an instruction.")

        # Per-project memory for the edit agent — best-effort fetch.
        edit_project_context = ""
        if project_id:
            try:
                from app.services.project_memory import ProjectMemoryService
                edit_project_context = ProjectMemoryService(project_id).get_context()
            except Exception as e:
                logger.warning(
                    "project_memory_read_failed_for_edit",
                    project_id=project_id,
                    error=str(e),
                )

        await publisher.publish(
            "editing", 0.3,
            f"Patching deck ({len(existing_slides)} slides loaded)...",
        )

        from app.agents.edit_agent import run_edit_agent
        result = await run_edit_agent(
            existing_slides=existing_slides,
            instruction=instruction,
            target_slides=target_slides,
            theme_config=theme_config,
            style_guide=style_guide,
            visual_style=visual_style,
            selected_model=selected_model,
            project_context=edit_project_context,
        )

        edited_numbers = result.get("editedSlideNumbers", [])
        summary = result.get("summary", "")
        patched_slides = result["slides"]

        # Write-back to project memory — even no-op edits get logged so the
        # agent knows the user asked something that didn't change the deck.
        if project_id:
            try:
                from app.services.project_memory import ProjectMemoryService
                ProjectMemoryService(project_id).record_edit(
                    instruction=instruction,
                    target_slides=edited_numbers or target_slides,
                    job_id=job_id,
                )
            except Exception as mem_err:
                logger.warning(
                    "project_memory_edit_writeback_failed",
                    job_id=job_id,
                    project_id=project_id,
                    error=str(mem_err),
                )

        if not edited_numbers:
            await publisher.publish(
                "complete", 1.0,
                f"No changes were applied: {summary or 'edit agent declined'}",
                data={"editedSlideNumbers": [], "summary": summary},
            )
            await publisher.close()
            return {"editedSlideNumbers": [], "summary": summary}

        await publisher.publish(
            "rendering", 0.7,
            f"Re-rendering deck — patched slide(s) {edited_numbers}: {summary[:120]}",
        )

        # Dispatch to the node-worker to render the patched deck.
        node_worker_queue = Queue("ppt-node-worker", {"connection": _get_redis_opts()})
        node_job_data = {
            "projectId": project_id,
            "jobId": job_id,
            "slides": patched_slides,
            "themeConfig": theme_config,
            "numSlides": len(patched_slides),
            "projectName": job_data.get("projectName", "Presentation"),
        }
        await node_worker_queue.add("generate-pptx", node_job_data)
        await node_worker_queue.close()

        logger.info(
            "edit_job_dispatched",
            job_id=job_id,
            edited=edited_numbers,
            summary=summary[:200],
        )

        # Node-worker will publish the final "complete" event after rendering.
        await publisher.close()
        return {
            "editedSlideNumbers": edited_numbers,
            "summary": summary,
        }

    except Exception as e:
        from app.services.error_classifier import classify, to_payload
        classified = classify(e)
        logger.error(
            "edit_job_failed",
            job_id=job_id,
            error=str(e),
            code=classified.code,
            provider=classified.provider,
        )
        await publisher.publish(
            "failed",
            1.0,
            classified.title + " — " + classified.message,
            data=to_payload(classified),
        )
        try:
            import psycopg
            with psycopg.connect(settings.database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """UPDATE jobs
                              SET status = 'FAILED',
                                  "currentPhase" = 'failed',
                                  error = %s,
                                  output = %s,
                                  "completedAt" = NOW(),
                                  "updatedAt" = NOW()
                            WHERE id = %s""",
                        (
                            f"[{classified.code}] {classified.title}: {classified.message}",
                            json.dumps(to_payload(classified)),
                            job_id,
                        ),
                    )
                    conn.commit()
        except Exception as db_err:
            logger.warning("edit_job_error_persist_failed", error=str(db_err))
        await publisher.close()
        if classified.retryable:
            raise
        return {"error": classified.code, "title": classified.title}


def start_worker() -> Worker:
    worker = Worker(
        "ppt-python-agent",
        process_python_agent_job,
        {
            "connection": _get_redis_opts(),
            "concurrency": settings.python_worker_concurrency,
        },
    )

    logger.info("python_worker_started", concurrency=settings.python_worker_concurrency)
    return worker
