from __future__ import annotations

import json
import redis.asyncio as aioredis
import structlog

from app.config import settings
from app.models import ProgressEvent

logger = structlog.get_logger()


class ProgressPublisher:
    def __init__(self, job_id: str) -> None:
        self.job_id = job_id
        self.channel = f"job:{job_id}:progress"
        self._redis: aioredis.Redis | None = None

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

    async def close(self) -> None:
        if self._redis:
            await self._redis.aclose()
            self._redis = None
