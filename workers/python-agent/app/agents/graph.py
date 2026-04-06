"""LangGraph pipeline with memory, reflection, and knowledge graph integration.

Flow:
  extract_template → process_references → query_generator → parallel_search
  → synthesizer → content_planner → slide_writer → reflection → END

Each node's output is persisted to AgentMemory. On retry, completed steps
are skipped and the pipeline resumes from the last failure point.

The reflection node visually inspects generated slides and suggests fixes.
Knowledge graph context is injected into content_planner and slide_writer.
"""

from __future__ import annotations

import time
from typing import Any

import structlog
from langgraph.graph import StateGraph, START, END

from app.models import PPTGenerationState
from app.agents.nodes import (
    extract_template,
    process_references,
    query_generator,
    parallel_search,
    synthesizer,
    content_planner,
    slide_writer,
    reflection,
)
from app.agents.memory import AgentMemory

logger = structlog.get_logger()


def _should_continue(state: PPTGenerationState) -> str:
    if state.get("error"):
        return END
    return "slide_writer"


def _after_slides(state: PPTGenerationState) -> str:
    if state.get("error"):
        return END
    return "reflection"


def build_graph() -> StateGraph:
    graph = StateGraph(PPTGenerationState)

    graph.add_node("extract_template", extract_template)
    graph.add_node("process_references", process_references)
    graph.add_node("query_generator", query_generator)
    graph.add_node("parallel_search", parallel_search)
    graph.add_node("synthesizer", synthesizer)
    graph.add_node("content_planner", content_planner)
    graph.add_node("slide_writer", slide_writer)
    graph.add_node("reflection", reflection)

    graph.add_edge(START, "extract_template")
    graph.add_edge("extract_template", "process_references")
    graph.add_edge("process_references", "query_generator")
    graph.add_edge("query_generator", "parallel_search")
    graph.add_edge("parallel_search", "synthesizer")
    graph.add_edge("synthesizer", "content_planner")
    graph.add_conditional_edges("content_planner", _should_continue)
    graph.add_conditional_edges("slide_writer", _after_slides)
    graph.add_edge("reflection", END)

    return graph


async def run_graph(
    initial_state: PPTGenerationState,
    thread_id: str,
) -> dict[str, Any]:
    """Run the graph with memory-backed resume support.

    If this job has previously completed steps (stored in AgentMemory),
    those steps are skipped and the pipeline resumes from where it left off.
    """
    job_id = initial_state.get("job_id", "unknown")
    memory = AgentMemory(job_id)

    # Clear any previously failed steps so they re-execute
    memory.clear_failed_steps()

    # Check for completed steps from a previous run
    completed_steps = memory.get_completed_steps()
    resume_state: dict[str, Any] = {}

    if completed_steps:
        logger.info(
            "resuming_from_memory",
            job_id=job_id,
            completed_steps=list(completed_steps.keys()),
        )
        resume_state = memory.get_resume_state()

    # Merge resume state into initial state (resume data takes precedence)
    merged_state: PPTGenerationState = {**initial_state, **resume_state}

    # Build the graph
    graph_builder = build_graph()
    compiled = graph_builder.compile()

    # Determine starting node
    next_step = memory.get_next_step()
    if next_step and next_step != "extract_template":
        logger.info("skipping_to_step", step=next_step, job_id=job_id)

    # Run the full graph (nodes that have cached results will short-circuit via the wrapper)
    # We wrap each node execution with memory save
    final_state: dict[str, Any] = dict(merged_state)

    # Execute nodes in order, skipping completed ones
    node_functions = {
        "extract_template": extract_template,
        "process_references": process_references,
        "query_generator": query_generator,
        "parallel_search": parallel_search,
        "synthesizer": synthesizer,
        "content_planner": content_planner,
        "slide_writer": slide_writer,
        "reflection": reflection,
    }

    for step_name in AgentMemory.STEP_ORDER:
        if step_name in completed_steps:
            logger.info("step_cached", step=step_name, job_id=job_id)
            continue

        node_fn = node_functions.get(step_name)
        if not node_fn:
            continue

        start_time = time.time()
        try:
            logger.info("step_starting", step=step_name, job_id=job_id)
            result = await node_fn(final_state)

            if isinstance(result, dict):
                final_state.update(result)
                duration_ms = int((time.time() - start_time) * 1000)
                memory.save_step(step_name, result, duration_ms=duration_ms)
                logger.info("step_completed", step=step_name, job_id=job_id, duration_ms=duration_ms)

            if final_state.get("error"):
                logger.error("step_error", step=step_name, error=final_state["error"])
                memory.save_step(step_name, {}, status="failed", error=final_state["error"])
                break

        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            memory.save_step(step_name, {}, status="failed", error=str(e), duration_ms=duration_ms)
            logger.error("step_failed", step=step_name, error=str(e), job_id=job_id)
            raise

    return final_state
