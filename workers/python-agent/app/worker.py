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

    try:
        await publisher.publish("starting", 0.0, "Starting AI agent pipeline...")

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
            "style_guide": job_data.get("styleGuide", ""),
            "visual_style": job_data.get("visualStyle", {}),
            "layout_patterns": job_data.get("layoutPatterns", []),
            "creative_mode": job_data.get("creativeMode", False),
            "chat_image_keys": job_data.get("chatImageKeys", []),
            "reference_visual_parts": [],
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

        if engine in ("claude-code", "claude-gemini"):
            # ── Claude Code Agent path (Anthropic or Gemini via proxy) ──
            use_gemini = engine == "claude-gemini"
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
            }
            await node_worker_queue.add("generate-pptx", node_job_data)
            await node_worker_queue.close()
            logger.info("node_worker_job_enqueued", job_id=job_id)

            # The node worker handles DB updates and S3 upload itself
            await publisher.close()
            return {"slides": slides, "themeConfig": theme_config}

        # Save presentation record to DB
        try:
            import psycopg
            with psycopg.connect(settings.database_url) as conn:
                with conn.cursor() as cur:
                    # Count existing versions
                    cur.execute('SELECT COUNT(*) FROM presentations WHERE "projectId" = %s', (project_id,))
                    version = (cur.fetchone()[0] or 0) + 1

                    # Create presentation record
                    cur.execute(
                        """INSERT INTO presentations (id, "projectId", title, "s3Key", "slideCount", version, "createdAt", "updatedAt")
                        VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, NOW(), NOW()) RETURNING id""",
                        (project_id, job_data.get("projectName", "Presentation"), s3_key, slide_count, version),
                    )
                    pres_id = cur.fetchone()[0]

                    # Update job
                    cur.execute(
                        """UPDATE jobs SET status = 'COMPLETED', progress = 1.0, "currentPhase" = 'complete',
                        output = %s, "completedAt" = NOW() WHERE id = %s""",
                        (json.dumps({"s3Key": s3_key, "slideCount": slide_count, "presentationId": pres_id}), job_id),
                    )
                    conn.commit()
                    logger.info("db_updated", job_id=job_id, presentation_id=pres_id)
        except Exception as db_err:
            logger.error("db_update_failed", error=str(db_err))

        await publisher.publish("complete", 1.0, "Presentation ready!", data={"s3Key": s3_key, "slideCount": slide_count})
        await publisher.close()

        return {"s3Key": s3_key, "slideCount": slide_count}

    except Exception as e:
        logger.error("job_failed", job_id=job_id, error=str(e))
        await publisher.publish("failed", 1.0, f"Job failed: {e}")
        await publisher.close()
        raise


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
