"""Kroki diagram rendering service.

Renders textual diagram definitions (Mermaid, PlantUML, D2, etc.) into PNG images
via the public Kroki API (https://kroki.io). The images are uploaded to S3 and a
presigned URL is returned for embedding in slides via slide.addImage({ path }).

Usage in slide_writer:
  The LLM outputs a special marker in the slide code:
    // KROKI:mermaid
    // graph TD; A-->B; B-->C;
    // END_KROKI
  The post-processor extracts these, renders via Kroki, uploads to S3,
  and replaces the marker with slide.addImage({ path: "<s3_url>", ... }).
"""

from __future__ import annotations

import base64
import zlib
from urllib.parse import quote

import httpx
import structlog

from app.config import settings
from app.services.s3 import S3Service

logger = structlog.get_logger()

KROKI_BASE_URL = "https://kroki.io"

# Supported diagram types
SUPPORTED_TYPES = {
    "mermaid", "plantuml", "d2", "graphviz", "dot", "blockdiag",
    "seqdiag", "actdiag", "nwdiag", "erd", "excalidraw", "vega",
    "vegalite", "ditaa", "svgbob", "bpmn", "bytefield", "tikz",
}


async def render_diagram(
    diagram_type: str,
    source: str,
    output_format: str = "png",
) -> bytes | None:
    """Render a diagram via Kroki and return raw image bytes."""
    dtype = diagram_type.lower().strip()
    if dtype not in SUPPORTED_TYPES:
        logger.warning("unsupported_kroki_type", dtype=dtype)
        return None

    try:
        # Use POST with JSON body for reliability
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{KROKI_BASE_URL}/{dtype}/{output_format}",
                headers={"Content-Type": "text/plain"},
                content=source.encode("utf-8"),
            )

        if resp.status_code != 200:
            logger.error("kroki_render_failed", status=resp.status_code, body=resp.text[:200])
            return None

        return resp.content

    except Exception as e:
        logger.error("kroki_render_error", error=str(e))
        return None


async def render_and_upload(
    diagram_type: str,
    source: str,
    job_id: str,
    slide_number: int,
    diagram_index: int = 0,
) -> str | None:
    """Render a diagram and upload to S3. Returns a presigned download URL."""
    image_bytes = await render_diagram(diagram_type, source, "png")
    if not image_bytes:
        return None

    s3 = S3Service()
    key = f"diagrams/{job_id}/slide_{slide_number}_diagram_{diagram_index}.png"

    try:
        s3.upload_bytes(image_bytes, key, content_type="image/png")
        url = s3.get_presigned_url(key, expires_in=86400)  # 24h
        logger.info("kroki_diagram_uploaded", key=key, size=len(image_bytes))
        return url
    except Exception as e:
        logger.error("kroki_s3_upload_failed", error=str(e))
        return None


def get_kroki_url(diagram_type: str, source: str, output_format: str = "png") -> str:
    """Generate a direct Kroki URL (no upload needed — works for simple embedding).

    This URL can be used directly in slide.addImage({ path: url }).
    Note: depends on kroki.io being accessible at render time.
    """
    compressed = zlib.compress(source.encode("utf-8"), 9)
    encoded = base64.urlsafe_b64encode(compressed).decode("ascii")
    return f"{KROKI_BASE_URL}/{diagram_type}/{output_format}/{encoded}"
