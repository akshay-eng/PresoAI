from __future__ import annotations

import asyncio

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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
from app.services.find_indexer import SlideIndexer
from app.services.find_search import search as find_search

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


# ─── Naming: short, descriptive summaries for project + presentation titles ───

class SummarizeNameRequest(BaseModel):
    text: str
    kind: str = "project"  # "project" or "presentation"


class SummarizeNameResponse(BaseModel):
    name: str


_PROJECT_SYSTEM = (
    "You name presentation projects. Read the user's request and return a "
    "single short, descriptive title (3-7 words, Title Case, no quotes, no "
    "markdown, no punctuation other than & and -). Examples:\n"
    "  Input: 'build me a 4-slide pitch for our agentic ITOps platform that "
    "auto-resolves production incidents for big enterprise SRE teams'\n"
    "  Output: Agentic ITOps Pitch Deck\n\n"
    "  Input: 'a presentation about climate change for high schoolers'\n"
    "  Output: Climate Change for High Schoolers\n\n"
    "  Input: 'help me draft a Q3 board update covering revenue, churn and roadmap'\n"
    "  Output: Q3 Board Update\n\n"
    "Output ONLY the title, nothing else."
)

_PRESENTATION_SYSTEM = (
    "You name PowerPoint files based on their cover slide and topic. Return a "
    "single short, descriptive filename WITHOUT the .pptx extension (3-8 "
    "words, Title Case, no quotes, no markdown, no path-looking characters). "
    "Examples:\n"
    "  Input cover title: 'From Reactive Chaos to Autonomous Resilience'\n"
    "  Output: From Reactive Chaos to Autonomous Resilience\n\n"
    "  Input cover title: 'Q3 Board Update — Revenue, Churn, Roadmap'\n"
    "  Output: Q3 Board Update\n\n"
    "Output ONLY the title, nothing else."
)


@router.post("/summarize-name", response_model=SummarizeNameResponse)
async def summarize_name(request: SummarizeNameRequest) -> SummarizeNameResponse:
    """Generate a short, human-readable title for a project or a presentation.

    Uses the server-side Gemini Flash key (very low cost). The web app calls
    this on every project creation and again when a presentation is rendered.
    """
    import os
    import aiohttp
    from app.config import settings

    api_key = (
        getattr(settings, "google_api_key", "")
        or os.environ.get("GOOGLE_API_KEY", "")
    ).strip()
    if not api_key:
        # No server key — return a sane fallback so callers never block.
        return SummarizeNameResponse(name=_fallback_name(request.text))

    system_text = _PROJECT_SYSTEM if request.kind != "presentation" else _PRESENTATION_SYSTEM
    # Naming is a trivial task — disable Gemini-2.5-Flash's thinking budget
    # so it produces output instead of burning all tokens on private reasoning,
    # and give it a comfortable token ceiling for the title itself.
    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": request.text[:4000]}]},
        ],
        "systemInstruction": {"parts": [{"text": system_text}]},
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 80,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash:generateContent?key={api_key}"
    )
    try:
        async with aiohttp.ClientSession() as http:
            async with http.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=12)) as resp:
                data = await resp.json()
                raw = ""
                try:
                    raw = data["candidates"][0]["content"]["parts"][0]["text"]
                except Exception:
                    raw = ""
        cleaned = _clean_name(raw) or _fallback_name(request.text)
        return SummarizeNameResponse(name=cleaned)
    except Exception as e:
        logger.warning("summarize_name_failed", error=str(e))
        return SummarizeNameResponse(name=_fallback_name(request.text))


def _clean_name(raw: str) -> str:
    """Strip quotes, markdown, trailing punctuation; collapse whitespace; cap length."""
    import re as _re
    s = (raw or "").strip()
    # Drop wrapping quotes/backticks.
    s = s.strip("\"'`*_ ")
    # First line only — model sometimes adds explanation.
    s = s.splitlines()[0].strip() if s else ""
    # Strip path / filename-hostile chars (matches the WOPI sanitizer's spirit).
    s = _re.sub(r"[\\/:*?\"<>|\[\]()`~]", " ", s)
    s = _re.sub(r"\s+", " ", s).strip()
    if len(s) > 80:
        s = s[:80].rstrip()
    return s


def _fallback_name(text: str) -> str:
    """Cheap heuristic for when the LLM is unavailable: first ~6 meaningful words."""
    import re as _re
    words = _re.sub(r"[\[\](){}<>]", " ", text).split()
    keep = [w for w in words if len(w) > 1][:7]
    title = " ".join(keep).title() if keep else "Untitled Deck"
    return _clean_name(title)


# ─── Intent router: decides whether a user message is a deck request ───

class ClassifyIntentRequest(BaseModel):
    text: str
    has_existing_deck: bool = False


class ClassifyIntentResponse(BaseModel):
    action: str   # "generate" | "edit" | "clarify" | "decline" | "greeting"
    reply: str    # human-facing message; empty when action=generate/edit


_INTENT_SYSTEM = (
    "You are the input router for Preso, a presentation-generation product. "
    "Preso ONLY builds professional slide decks (PowerPoint .pptx) from a "
    "prompt. It does NOT write code, do general research, answer trivia, "
    "chat, generate images, or help with anything that isn't a slide deck.\n\n"
    "Given the user's message, output ONE JSON object: "
    '{"action":"...", "reply":"..."}.\n\n'
    "action must be EXACTLY one of:\n"
    "  generate — message clearly describes a deck to build (has a topic / intent)\n"
    "  edit     — user is asking to modify an existing deck (only valid when has_existing_deck=true)\n"
    "  clarify  — message hints at wanting a deck but is missing key info (topic too vague, no audience, etc.)\n"
    "  greeting — message is a greeting, thanks, capability question, or 'help'\n"
    "  decline  — message is unrelated to building a deck (chitchat, code request, weather, math, trivia, etc.)\n\n"
    "For action=generate or edit, reply MUST be an empty string.\n"
    "For greeting, clarify, decline: reply is a SHORT friendly message (1-2 sentences) "
    "that tells the user what Preso does and either asks what deck they want or asks "
    "the specific clarifying question. Keep it warm but direct. Do NOT pretend Preso "
    "can do something it cannot.\n\n"
    "Examples:\n"
    'Input: "hi" (has_existing_deck=false)\n'
    '{"action":"greeting","reply":"Hi! I build professional slide decks. What topic do you want a deck on, and roughly who is the audience?"}\n\n'
    'Input: "what can you do?" (has_existing_deck=false)\n'
    '{"action":"greeting","reply":"I generate marketing-quality PowerPoint decks from a prompt — give me a topic, audience (executive, technical, general, marketing), and roughly how many slides. I don\'t help with code, general research, or other tasks outside slide decks."}\n\n'
    'Input: "write me a poem about autumn"\n'
    '{"action":"decline","reply":"I only build slide decks, so I can\'t write a poem. If you\'d like a deck about autumn (or any topic), tell me the audience and slide count and I\'ll create it."}\n\n'
    'Input: "what\'s the weather in Bangalore"\n'
    '{"action":"decline","reply":"I\'m a presentation generator and don\'t have access to live data. If you want a deck on something — Bangalore tech, climate, anything — I\'m ready."}\n\n'
    'Input: "make me a 10-slide pitch deck for our agentic ITOps platform for a Fortune 500 audience"\n'
    '{"action":"generate","reply":""}\n\n'
    'Input: "deck about dogs"\n'
    '{"action":"clarify","reply":"Got it — a deck about dogs. Who\'s the audience (kids, owners, vets), roughly how many slides, and any specific angle (training, breeds, health)?"}\n\n'
    'Input: "change slide 3 to use a bar chart" (has_existing_deck=true)\n'
    '{"action":"edit","reply":""}\n\n'
    'Input: "tell me about kubernetes"\n'
    '{"action":"decline","reply":"I\'m a slide-deck generator, not a Q&A assistant. If you want a Kubernetes deck (overview, architecture pitch, training material), tell me the audience and slide count and I\'ll build it."}\n\n'
    "Output ONLY the JSON object, nothing else."
)


@router.post("/classify-intent", response_model=ClassifyIntentResponse)
async def classify_intent(request: ClassifyIntentRequest) -> ClassifyIntentResponse:
    """Classify a user's chat message: is this a deck request, or something else?

    Returns the action plus a friendly user-facing reply for non-deck inputs.
    Falls back to a heuristic when no API key is configured.
    """
    import os
    import json as _json
    import aiohttp
    from app.config import settings

    text = (request.text or "").strip()
    if not text:
        return ClassifyIntentResponse(
            action="clarify",
            reply="What kind of deck would you like me to build? Tell me the topic, audience, and roughly how many slides.",
        )

    # Cheap heuristic short-circuit for the most obvious cases — saves a round-trip.
    heuristic = _heuristic_intent(text, request.has_existing_deck)
    if heuristic is not None:
        return heuristic

    api_key = (
        getattr(settings, "google_api_key", "")
        or os.environ.get("GOOGLE_API_KEY", "")
    ).strip()
    if not api_key:
        # No LLM available — be conservative: assume it's a deck request so
        # we don't block legitimate users when the routing model is offline.
        return ClassifyIntentResponse(action="generate", reply="")

    user_text = (
        f"has_existing_deck={'true' if request.has_existing_deck else 'false'}\n"
        f"message: {text[:1500]}"
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": user_text}]}],
        "systemInstruction": {"parts": [{"text": _INTENT_SYSTEM}]},
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 200,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash:generateContent?key={api_key}"
    )
    try:
        async with aiohttp.ClientSession() as http:
            async with http.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                data = await resp.json()
        raw = ""
        try:
            raw = data["candidates"][0]["content"]["parts"][0]["text"]
        except Exception:
            raw = ""
        parsed = _parse_intent_json(raw)
        if parsed is None:
            return ClassifyIntentResponse(action="generate", reply="")
        action = parsed.get("action", "generate")
        if action not in {"generate", "edit", "clarify", "decline", "greeting"}:
            action = "generate"
        # Edits are only legitimate when an existing deck exists.
        if action == "edit" and not request.has_existing_deck:
            action = "generate"
        reply = parsed.get("reply", "")
        if action in {"generate", "edit"}:
            reply = ""
        return ClassifyIntentResponse(action=action, reply=reply)
    except Exception as e:
        logger.warning("classify_intent_failed", error=str(e))
        return ClassifyIntentResponse(action="generate", reply="")


def _heuristic_intent(text: str, has_existing_deck: bool):
    """Match the most common cases without burning an LLM call."""
    t = text.strip().lower()
    # Very short messages (≤3 words) that are pure greetings or thanks.
    word_count = len(t.split())
    pure_greetings = {
        "hi", "hello", "hey", "yo", "hi.", "hello.", "hey there",
        "good morning", "good afternoon", "good evening",
        "thanks", "thank you", "thx", "ty",
        "ok", "okay", "cool", "great",
    }
    if t in pure_greetings:
        return ClassifyIntentResponse(
            action="greeting",
            reply="Hi! I build professional slide decks. What topic do you want a deck on, and roughly who is the audience?",
        )
    # "what can you do" / "help" — capability questions.
    if t in {"help", "?", "/help"} or any(
        phrase in t for phrase in (
            "what can you do", "what do you do", "what is this",
            "who are you", "how does this work", "how do i use",
        )
    ):
        return ClassifyIntentResponse(
            action="greeting",
            reply=(
                "I generate marketing-quality PowerPoint decks from a prompt — "
                "give me a topic, audience (executive, technical, general, "
                "marketing), and roughly how many slides. I don't help with "
                "code, general research, or anything outside slide decks."
            ),
        )
    # Single-word non-deck inputs that are clearly off-topic.
    if word_count == 1 and t.isalpha() and t not in pure_greetings:
        # Things like "weather", "kubernetes", "python" — too vague to be a deck request.
        return ClassifyIntentResponse(
            action="clarify",
            reply=(
                f"Are you looking for a deck about \"{text}\"? If so, tell me "
                "the audience and roughly how many slides. If you want me to "
                "do something other than build a deck — that's outside what "
                "Preso does."
            ),
        )
    return None


def _parse_intent_json(raw: str) -> dict | None:
    import json as _json
    import re as _re
    cleaned = (raw or "").strip()
    fence = _re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", cleaned)
    if fence:
        cleaned = fence.group(1)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return _json.loads(cleaned[start : end + 1])
    except _json.JSONDecodeError:
        return None


# ─── Find: slide-level search ───

class IndexPptxRequest(BaseModel):
    user_id: str
    source_file_id: str
    s3_key: str
    thumbnail_prefix: str


class IndexPptxResponse(BaseModel):
    slide_count: int
    indexed: int


@router.post("/find/index-pptx", response_model=IndexPptxResponse)
async def index_pptx(request: IndexPptxRequest) -> IndexPptxResponse:
    indexer = SlideIndexer()
    try:
        # Run the heavy CPU/GPU work off the event loop.
        result = await asyncio.to_thread(
            indexer.index_pptx,
            user_id=request.user_id,
            source_file_id=request.source_file_id,
            s3_key=request.s3_key,
            thumbnail_prefix=request.thumbnail_prefix,
        )
        return IndexPptxResponse(**result)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Source file not found in S3")
    except Exception as exc:
        logger.error("index_pptx_failed", error=str(exc))
        raise HTTPException(status_code=500, detail=f"Indexing failed: {exc}")


class SearchRequest(BaseModel):
    user_id: str
    query: str
    limit: int = 24


class SearchResultItem(BaseModel):
    id: str
    rank: int
    score: float
    slide_number: int
    thumbnail_s3_key: str
    snippet: str
    source_file_id: str
    source_file_name: str
    dominant_colors: list | None = None


class SearchResponse(BaseModel):
    results: list[SearchResultItem]


@router.post("/find/search", response_model=SearchResponse)
async def search_slides(request: SearchRequest) -> SearchResponse:
    try:
        results = await asyncio.to_thread(
            find_search,
            user_id=request.user_id,
            query=request.query,
            limit=request.limit,
        )
        return SearchResponse(results=results)
    except Exception as exc:
        logger.error("search_failed", error=str(exc))
        raise HTTPException(status_code=500, detail=f"Search failed: {exc}")
