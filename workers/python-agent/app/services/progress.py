from __future__ import annotations

import asyncio
import json
import redis.asyncio as aioredis
import psycopg
import structlog

from app.config import settings
from app.models import ProgressEvent

logger = structlog.get_logger()


class ProgressPublisher:
    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self.channel = f"job:{job_id}:progress"
        self._redis: aioredis.Redis | None = None
        # Throttle DB writes — we publish progress at every minor step which
        # is too chatty for an UPDATE per event. ~1 DB write per second is
        # plenty for the HTTP-poll fallback path.
        self._last_db_write: float = 0.0

    async def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(settings.redis_url)
        return self._redis

    async def publish(
        self,
        phase: str,
        progress: float,
        message: str,
        data: dict | None = None,
    ) -> None:
        redis = await self._get_redis()
        event = ProgressEvent(
            phase=phase,
            progress=progress,
            message=message,
            data=data,
        )
        payload = json.dumps(event.model_dump())
        logger.info(
            "publishing_progress",
            job_id=self.job_id,
            phase=phase,
            progress=progress,
        )
        await redis.publish(self.channel, payload)

        # Mirror to the jobs table so HTTP poll fallback + the active-job
        # endpoint see the same state SSE does. Without this, the UI flips
        # between live SSE updates and stale DB rows, looking like the job
        # is "stuck pending". Throttled to 1/sec; terminal phases always
        # write so completion/failure is reflected immediately.
        now = asyncio.get_event_loop().time()
        is_terminal = phase in ("complete", "failed", "retrying")
        if is_terminal or (now - self._last_db_write) >= 1.0:
            self._last_db_write = now
            try:
                await asyncio.to_thread(self._write_job_progress, phase, progress)
            except Exception as e:  # never let a DB blip break the worker
                logger.warning(
                    "progress_db_write_failed",
                    job_id=self.job_id,
                    error=str(e),
                )

    def _write_job_progress(self, phase: str, progress: float) -> None:
        with psycopg.connect(settings.database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE jobs
                       SET "currentPhase" = %s,
                           progress = %s,
                           "updatedAt" = NOW()
                     WHERE id = %s
                    """,
                    (phase, progress, self.job_id),
                )
                conn.commit()

    async def close(self) -> None:
        if self._redis:
            await self._redis.aclose()
            self._redis = None
