"""Slide Vision Service — converts PPTX slides to images and analyzes them visually.

Uses LibreOffice to convert slides to PNG, then sends to multimodal LLM
for deep visual analysis of design patterns, layout structure, and styling.
"""

from __future__ import annotations

import base64
import io
import os
import random
import shutil
import subprocess
import tempfile
from pathlib import Path

import structlog
from PIL import Image
from pptx import Presentation

from app.config import settings

logger = structlog.get_logger()

# Try multiple LibreOffice paths
LIBREOFFICE_PATHS = [
    os.environ.get("LIBREOFFICE_PATH", ""),
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
]

THUMBNAIL_WIDTH = 1280
THUMBNAIL_HEIGHT = 720


def _find_libreoffice() -> str:
    for path in LIBREOFFICE_PATHS:
        if path and os.path.isfile(path):
            return path
    # Try 'soffice' in PATH
    result = shutil.which("soffice") or shutil.which("libreoffice")
    if result:
        return result
    raise FileNotFoundError("LibreOffice not found. Install it or set LIBREOFFICE_PATH.")


def pptx_to_images(pptx_path: str | Path, max_slides: int | None = None) -> list[bytes]:
    """Convert PPTX slides to PNG images using LibreOffice.

    Returns list of PNG bytes, one per slide.
    """
    libreoffice = _find_libreoffice()
    tmp_dir = tempfile.mkdtemp(prefix="sf-vision-")

    try:
        # First convert to PDF (more reliable than direct PNG)
        result = subprocess.run(
            [libreoffice, "--headless", "--convert-to", "pdf", "--outdir", tmp_dir, str(pptx_path)],
            capture_output=True,
            timeout=120,
            env={**os.environ, "HOME": tmp_dir},
        )

        if result.returncode != 0:
            logger.warn("libreoffice_pdf_failed", stderr=result.stderr.decode()[:300])
            # Fallback: try direct PNG conversion
            return _convert_via_png(libreoffice, str(pptx_path), tmp_dir, max_slides)

        # Find the PDF
        pdf_files = [f for f in os.listdir(tmp_dir) if f.endswith(".pdf")]
        if not pdf_files:
            logger.warn("no_pdf_produced")
            return []

        pdf_path = os.path.join(tmp_dir, pdf_files[0])

        # Use pdftoppm (poppler) to convert PDF pages to PNG
        png_dir = os.path.join(tmp_dir, "pngs")
        os.makedirs(png_dir, exist_ok=True)

        pdftoppm = shutil.which("pdftoppm")
        if pdftoppm:
            subprocess.run(
                [pdftoppm, "-png", "-r", "150", pdf_path, os.path.join(png_dir, "slide")],
                capture_output=True,
                timeout=60,
            )
        else:
            # Fallback to PIL for PDF rendering
            return _convert_via_png(libreoffice, str(pptx_path), tmp_dir, max_slides)

        # Read PNGs
        png_files = sorted([f for f in os.listdir(png_dir) if f.endswith(".png")])
        images: list[bytes] = []

        for png_file in png_files:
            png_path = os.path.join(png_dir, png_file)
            img = Image.open(png_path)
            img = img.resize((THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            images.append(buf.getvalue())

        if max_slides and len(images) > max_slides:
            # Smart sample: first, last, and random from middle
            indices = _pick_diverse_indices(len(images), max_slides)
            images = [images[i] for i in indices]

        logger.info("slides_converted", total=len(png_files), returned=len(images))
        return images

    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _convert_via_png(
    libreoffice: str, pptx_path: str, tmp_dir: str, max_slides: int | None
) -> list[bytes]:
    """Fallback: direct LibreOffice to PNG conversion."""
    result = subprocess.run(
        [libreoffice, "--headless", "--convert-to", "png", "--outdir", tmp_dir, pptx_path],
        capture_output=True,
        timeout=120,
        env={**os.environ, "HOME": tmp_dir},
    )

    png_files = sorted([f for f in os.listdir(tmp_dir) if f.endswith(".png")])
    images: list[bytes] = []
    for png_file in png_files:
        path = os.path.join(tmp_dir, png_file)
        img = Image.open(path)
        img = img.resize((THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        images.append(buf.getvalue())

    return images


def _pick_diverse_indices(total: int, count: int) -> list[int]:
    """Pick diverse slide indices: first, last, and spread from middle."""
    if total <= count:
        return list(range(total))

    indices = {0, total - 1}  # Always first and last

    # Evenly spread remaining picks
    remaining = count - len(indices)
    if remaining > 0:
        step = total / (remaining + 1)
        for i in range(1, remaining + 1):
            indices.add(int(step * i))

    return sorted(indices)[:count]


def images_to_base64_messages(
    images: list[bytes], labels: list[str] | None = None
) -> list[dict]:
    """Convert images to OpenAI/Gemini-compatible multimodal message content parts."""
    parts: list[dict] = []
    for i, img_bytes in enumerate(images):
        label = labels[i] if labels and i < len(labels) else f"Slide {i + 1}"
        b64 = base64.b64encode(img_bytes).decode("utf-8")
        parts.append({"type": "text", "text": f"\n[{label}]"})
        parts.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"},
        })
    return parts
