"""logo.dev integration — fetch brand/company logos to enrich slides.

Two functions are exposed:

- ``extract_brand_mentions``: cheap LLM call that returns a deduped list of
  brand/company/tool names mentioned in some text (prompt + outline).
- ``resolve_brand_logos``: hits logo.dev's search endpoint for each brand and
  returns a ``{brand_name: logo_url}`` mapping.

The slide_writer node is responsible for calling both and passing the
resulting mapping into the LLM prompt so the model can place logos via
``slide.addImage({ path: <logo_url>, ... })``.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()

LOGO_DEV_SEARCH_URL = "https://api.logo.dev/search"
MAX_BRANDS = 12  # cap to keep prompts small and API calls bounded


async def extract_brand_mentions(text: str, llm: Any) -> list[str]:
    """Use the provided LLM to pull brand/company/tool names out of free text.

    Returns at most ``MAX_BRANDS`` deduped names. On any failure (parse error,
    LLM error, empty), returns an empty list — callers should treat logos as
    optional.
    """
    if not text.strip():
        return []

    system = (
        "Extract brand, company, product, or technology names mentioned in the text. "
        "Only return real entities that have a recognizable logo "
        "(e.g. 'Kubernetes', 'Prometheus', 'Stripe', 'Sweetgreen'). "
        "Skip generic words like 'ops', 'monitoring', 'cloud'. "
        "Return ONLY a JSON array of strings, no prose. Maximum 12 entries. "
        "If nothing applies, return []."
    )

    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        result = await llm.ainvoke(
            [SystemMessage(content=system), HumanMessage(content=text[:4000])]
        )
        raw = result.content if hasattr(result, "content") else str(result)
        # Pull out the JSON array even if the model wraps it in code fences
        match = re.search(r"\[[^\]]*\]", raw, re.DOTALL)
        if not match:
            return []
        names = json.loads(match.group(0))
        if not isinstance(names, list):
            return []
        cleaned = []
        seen: set[str] = set()
        for n in names:
            if not isinstance(n, str):
                continue
            key = n.strip().lower()
            if not key or key in seen:
                continue
            seen.add(key)
            cleaned.append(n.strip())
            if len(cleaned) >= MAX_BRANDS:
                break
        return cleaned
    except Exception as e:
        logger.warning("brand_extraction_failed", error=str(e))
        return []


async def _search_one(client: httpx.AsyncClient, name: str) -> tuple[str, str | None]:
    try:
        r = await client.get(
            LOGO_DEV_SEARCH_URL,
            params={"q": name},
            headers={"Authorization": f"Bearer {settings.logo_dev_api_key}"},
            timeout=8.0,
        )
        if r.status_code != 200:
            return name, None
        data = r.json()
        # logo.dev returns a list of matches; pick the first with a logo_url
        if isinstance(data, list) and data:
            top = data[0]
            url = top.get("logo_url") or top.get("logoUrl")
            if url:
                return name, url
        return name, None
    except Exception as e:
        logger.warning("logo_dev_search_failed", brand=name, error=str(e))
        return name, None


async def resolve_brand_logos(names: list[str]) -> dict[str, str]:
    """Search logo.dev for each name in parallel; return {name: logo_url}.

    Skips entirely if no API key is configured. Names with no match are
    omitted from the returned dict.
    """
    if not names or not settings.logo_dev_api_key:
        return {}

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*(_search_one(client, n) for n in names))

    return {name: url for name, url in results if url}
