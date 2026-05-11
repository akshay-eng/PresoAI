"""Mood classifier — picks one of N moods given content + audience.

Initial implementation is heuristic (audience + keyword scan). A future
upgrade can replace this with an LLM call when budget allows.
"""

from __future__ import annotations

MOODS = [
    "vibrant-tech",
    "vibrant-creative",
    "corporate-trust",
    "fintech-precise",
    "healthcare-calm",
    "luxury-muted",
    "monochrome-minimal",
    "startup-energetic",
]

DEFAULT_BY_AUDIENCE = {
    "marketing": "vibrant-creative",
    "executive": "corporate-trust",
    "technical": "monochrome-minimal",
    "general": "corporate-trust",
}

KEYWORD_HINTS = [
    (("crypto", "blockchain", "web3", "ai", "saas", "platform", "api"), "vibrant-tech"),
    (("brand", "creative", "agency", "design", "campaign"), "vibrant-creative"),
    (("startup", "launch", "investor", "pitch", "raise", "seed", "series"), "startup-energetic"),
    (("bank", "finance", "fintech", "trading", "investment", "wealth"), "fintech-precise"),
    (("health", "wellness", "medical", "clinic", "patient", "therapy"), "healthcare-calm"),
    (("luxury", "premium", "exclusive", "boutique", "couture"), "luxury-muted"),
    (("strategy", "consulting", "enterprise", "operations", "compliance"), "corporate-trust"),
]


def classify_mood(prompt: str, audience: str = "general") -> str:
    """Pick a mood based on prompt content and audience.

    Audience default is the floor; keyword hits override when strong.
    """
    audience_default = DEFAULT_BY_AUDIENCE.get(audience, "corporate-trust")
    if not prompt:
        return audience_default

    lower = prompt.lower()
    for keywords, mood in KEYWORD_HINTS:
        if any(k in lower for k in keywords):
            return mood

    return audience_default
