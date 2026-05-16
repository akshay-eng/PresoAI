"""Image generation via Gemini's "Nano Banana" (gemini-2.5-flash-image-preview).

Generates a single photo-realistic image from a text prompt. Used by the
slide writer when a slide calls for a hero background photo / lifestyle
image — the LLM emits an IMAGE_GEN marker, the post-processor renders the
image here, uploads to S3, and embeds it into the slide alongside a
brand-color tint overlay (kept in pptxgenjs so the deck stays editable).

The Cognizant-style "person on phone with blue tint" cover is the
canonical use case.
"""

from __future__ import annotations

import base64
import json
import os
from io import BytesIO

import httpx
import structlog

logger = structlog.get_logger()

# Gemini's image generation model. "Nano Banana" was the codename; the
# preview id (gemini-2.5-flash-image-preview) was retired after GA. The
# current lineup, newest-first (verified via /v1beta/models on 2026-05-16):
#   - gemini-3.1-flash-image-preview   (latest preview, JPEG output)
#   - gemini-3-pro-image-preview       (pro tier, slower)
#   - gemini-2.5-flash-image           (GA stable, PNG output)
# We try the preview first for highest quality, fall back to the GA model
# if a key doesn't have preview access yet, then bail to None.
DEFAULT_MODEL = "gemini-3.1-flash-image-preview"
FALLBACK_MODELS = ("gemini-2.5-flash-image",)
GENERATIVE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

# Cap output size so we don't bloat S3 / the .pptx. 1280px on the long
# edge is plenty for a full-bleed background photo at 1080p screens.
MAX_DIM_PX = 1280


async def generate_image(
    prompt: str,
    api_key: str | None = None,
    model: str = DEFAULT_MODEL,
    aspect_ratio: str = "16:9",
) -> bytes | None:
    """Call Gemini Nano Banana and return raw image bytes (JPEG).

    Returns None on any failure (network, missing key, bad response). The
    slide-writer post-processor falls back gracefully — the image marker
    is replaced by a neutral-tinted shape placeholder so the slide still
    renders cleanly.

    `aspect_ratio` accepts strings like "16:9", "4:3", "1:1", "9:16".
    """
    key = (api_key or os.environ.get("GOOGLE_API_KEY", "")).strip()
    if not key:
        logger.warning("image_gen_skipped", reason="no_google_api_key")
        return None

    # Inline the aspect ratio into the prompt — the API doesn't currently
    # honor a dedicated aspect_ratio field on this model.
    final_prompt = (
        f"{prompt.strip()}\n\n"
        f"Photo-realistic, high-quality, suitable for a corporate presentation "
        f"background. Aspect ratio: {aspect_ratio}. No text or watermarks in "
        f"the image. Leave room on the side for overlay text."
    )

    # Try the requested model first, then each fallback. A 404 on the
    # primary means "this key doesn't have access to that model yet" —
    # silently retry on the GA model rather than blanking out the cover
    # slide.
    candidates_to_try = [model, *(m for m in FALLBACK_MODELS if m != model)]
    for attempt_idx, candidate_model in enumerate(candidates_to_try):
        url = f"{GENERATIVE_BASE_URL}/{candidate_model}:generateContent?key={key}"
        payload = {
            "contents": [
                {"role": "user", "parts": [{"text": final_prompt}]}
            ],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": {"aspectRatio": aspect_ratio},
            },
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                logger.warning(
                    "image_gen_http_error",
                    status=resp.status_code,
                    model=candidate_model,
                    body=resp.text[:400],
                )
                # 404 → model not available on this key; fall through to
                # the next candidate. Other errors (quota, safety) won't
                # be fixed by switching model, so bail.
                if resp.status_code == 404 and attempt_idx < len(candidates_to_try) - 1:
                    continue
                return None
            data = resp.json()
        except Exception as e:
            logger.warning("image_gen_request_failed", error=str(e), model=candidate_model)
            return None

        # Walk the response for the first inline_data part with image MIME.
        try:
            for cand in data.get("candidates", []):
                parts = (cand.get("content") or {}).get("parts", [])
                for p in parts:
                    inline = p.get("inlineData") or p.get("inline_data")
                    if not inline:
                        continue
                    mime = inline.get("mimeType") or inline.get("mime_type") or ""
                    if not mime.startswith("image/"):
                        continue
                    b64 = inline.get("data")
                    if not b64:
                        continue
                    img_bytes = base64.b64decode(b64)
                    resized = _maybe_resize(img_bytes)
                    logger.info(
                        "image_gen_ok",
                        bytes=len(resized),
                        mime=mime,
                        aspect=aspect_ratio,
                        model=candidate_model,
                    )
                    return resized
        except Exception as e:
            logger.warning(
                "image_gen_parse_failed",
                error=str(e),
                model=candidate_model,
                body=json.dumps(data)[:400],
            )
            return None

        logger.warning(
            "image_gen_no_image_in_response",
            model=candidate_model,
            body=json.dumps(data)[:400],
        )
        # No image in this response — try the next model rather than
        # giving up.

    return None


def _maybe_resize(img_bytes: bytes) -> bytes:
    """Downscale to MAX_DIM_PX on the long edge if available; otherwise
    return as-is. Pillow is optional — if it's not installed, we just
    accept whatever Gemini returns."""
    try:
        from PIL import Image
    except ImportError:
        return img_bytes

    try:
        img = Image.open(BytesIO(img_bytes))
        w, h = img.size
        long_edge = max(w, h)
        if long_edge <= MAX_DIM_PX:
            return img_bytes
        scale = MAX_DIM_PX / long_edge
        new_size = (int(w * scale), int(h * scale))
        resized = img.resize(new_size, Image.LANCZOS)
        # Force RGB for JPEG output.
        if resized.mode in ("RGBA", "P"):
            resized = resized.convert("RGB")
        out = BytesIO()
        resized.save(out, format="JPEG", quality=82, optimize=True)
        return out.getvalue()
    except Exception:
        return img_bytes
