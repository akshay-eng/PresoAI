"""Agent Memory — persists step results so the pipeline can resume from failures.

Each completed step's output is saved to the agent_memory table.
On retry, the pipeline checks which steps already completed and skips them.
"""

from __future__ import annotations

import json
import time
from typing import Any

import psycopg
import structlog

from app.config import settings

logger = structlog.get_logger()


class AgentMemory:
    """Per-job memory that survives process restarts."""

    STEP_ORDER = [
        "extract_template",
        "process_references",
        "query_generator",
        "parallel_search",
        "synthesizer",
        "content_planner",
        "slide_writer",
        "reflection",
    ]

    def __init__(self, job_id: str) -> None:
        self.job_id = job_id

    def _get_conn(self) -> psycopg.Connection:
        return psycopg.connect(settings.database_url)

    def save_step(
        self,
        step_name: str,
        output: dict,
        status: str = "completed",
        error: str | None = None,
        duration_ms: int | None = None,
    ) -> None:
        """Save or update a step's result."""
        step_index = self.STEP_ORDER.index(step_name) if step_name in self.STEP_ORDER else -1

        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO agent_memory (id, "jobId", "stepName", "stepIndex", status, output, error, "durationMs", "createdAt")
                    VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT ("jobId", "stepName") DO UPDATE SET
                        status = EXCLUDED.status,
                        output = EXCLUDED.output,
                        error = EXCLUDED.error,
                        "durationMs" = EXCLUDED."durationMs"
                    """,
                    (self.job_id, step_name, step_index, status, json.dumps(output), error, duration_ms),
                )
                conn.commit()
        logger.info("step_saved", job_id=self.job_id, step=step_name, status=status)

    def get_completed_steps(self) -> dict[str, dict]:
        """Get all completed steps and their outputs."""
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT "stepName", output FROM agent_memory WHERE "jobId" = %s AND status = %s ORDER BY "stepIndex"',
                    (self.job_id, "completed"),
                )
                return {
                    row[0]: json.loads(row[1]) if isinstance(row[1], str) else row[1]
                    for row in cur.fetchall()
                }

    def get_last_failed_step(self) -> str | None:
        """Get the name of the last failed step, if any."""
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'SELECT "stepName" FROM agent_memory WHERE "jobId" = %s AND status = %s ORDER BY "stepIndex" DESC LIMIT 1',
                    (self.job_id, "failed"),
                )
                row = cur.fetchone()
                return row[0] if row else None

    def get_resume_state(self) -> dict:
        """Build a state dict from all completed steps' outputs, for resuming."""
        completed = self.get_completed_steps()
        merged_state: dict = {}
        for step_name in self.STEP_ORDER:
            if step_name in completed:
                merged_state.update(completed[step_name])
        return merged_state

    def clear_failed_steps(self) -> int:
        """Delete all failed step records so they can be re-executed on retry."""
        with self._get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    'DELETE FROM agent_memory WHERE "jobId" = %s AND status = %s',
                    (self.job_id, "failed"),
                )
                count = cur.rowcount
                conn.commit()
        if count:
            logger.info("cleared_failed_steps", job_id=self.job_id, count=count)
        return count

    def get_next_step(self) -> str | None:
        """Determine which step to run next (first non-completed step)."""
        completed = set(self.get_completed_steps().keys())
        for step in self.STEP_ORDER:
            if step not in completed:
                return step
        return None  # All steps done
