from __future__ import annotations

import structlog
from fastapi import APIRouter, HTTPException

from app.models import (
    ExtractThemeRequest,
    ExtractThemeResponse,
    ExtractReferenceRequest,
    ExtractReferenceResponse,
)
from app.models.style_profile import (
    AnalyzeStyleRequest,
    AnalyzeStyleResponse,
)
from app.services.extraction import ThemeExtractor, ReferenceExtractor
from app.services.style_analyzer import StyleAnalyzer

logger = structlog.get_logger()

router = APIRouter()


@router.post("/extract-theme", response_model=ExtractThemeResponse)
async def extract_theme(request: ExtractThemeRequest) -> ExtractThemeResponse:
    try:
        extractor = ThemeExtractor()
        theme = extractor.extract(request.s3_key)
        return ExtractThemeResponse(theme=theme)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Template file not found in S3")
    except Exception as e:
        logger.error("theme_extraction_error", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to extract theme: {e}")


@router.post("/extract-reference", response_model=ExtractReferenceResponse)
async def extract_reference(request: ExtractReferenceRequest) -> ExtractReferenceResponse:
    try:
        extractor = ReferenceExtractor()
        text, structure = extractor.extract(request.s3_key, request.file_type)
        return ExtractReferenceResponse(text=text, structure=structure)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Reference file not found in S3")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("reference_extraction_error", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to extract reference: {e}")


@router.post("/analyze-style", response_model=AnalyzeStyleResponse)
async def analyze_style(request: AnalyzeStyleRequest) -> AnalyzeStyleResponse:
    """Analyze multiple PPTX files to build a reusable style profile.

    This endpoint:
    1. Downloads each PPTX from S3
    2. Extracts theme XML (colors, fonts, layouts) — 0 LLM tokens
    3. Smart-samples 3-4 diverse slides per file
    4. Sends sampled slide images to multimodal LLM for visual analysis
    5. Merges everything into a StyleProfileData
    """
    try:
        analyzer = StyleAnalyzer()
        source_files = [
            {
                "source_id": sf.source_id,
                "s3_key": sf.s3_key,
                "file_name": sf.file_name,
            }
            for sf in request.source_files
        ]

        profile_data, file_results = await analyzer.analyze_files(
            source_files=source_files,
            model_config=request.model_config_dict or None,
            user_id=request.user_id,
        )

        return AnalyzeStyleResponse(
            style_profile_id=request.style_profile_id,
            status="ready",
            style_guide=profile_data.style_guide,
            visual_style=profile_data.visual_style,
            theme_config=profile_data.theme_colors,
            layout_patterns=[lp.model_dump() for lp in profile_data.layout_patterns],
        )

    except Exception as e:
        logger.error("style_analysis_error", error=str(e))
        raise HTTPException(status_code=500, detail=f"Style analysis failed: {e}")


@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}
