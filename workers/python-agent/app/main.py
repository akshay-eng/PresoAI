from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI

from app.api.routes import router
from app.worker import start_worker

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.dev.ConsoleRenderer() if True else structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(0),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()

worker_instance = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    global worker_instance
    logger.info("starting_application")

    try:
        worker_instance = start_worker()
        logger.info("bullmq_worker_started")
    except Exception as e:
        logger.error("worker_start_failed", error=str(e))

    yield

    if worker_instance:
        try:
            await worker_instance.close()
            logger.info("bullmq_worker_stopped")
        except Exception as e:
            logger.error("worker_stop_failed", error=str(e))


app = FastAPI(
    title="SlideForge Python Agent",
    description="LangGraph-based AI agent for presentation generation",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(router)
