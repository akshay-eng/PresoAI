"""Classify upstream errors into actionable codes + user-friendly messages.

Used by the worker to translate raw exception strings (which contain provider
JSON, stack traces, etc.) into something the UI can render nicely with a
clear next step ("switch model", "add credits", "retry later").

Codes match what the web app's error renderer expects — keep them in sync
with `apps/web/lib/job-errors.ts` (the client-side mapper).
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ClassifiedError:
    code: str            # machine-readable, see CODES below
    title: str           # short headline ("Anthropic credits exhausted")
    message: str         # 1-2 sentence user-facing explanation
    hint: str            # actionable next step ("Switch to Gemini, or…")
    provider: str | None # openai | anthropic | google | mistral | None
    retryable: bool      # True if retrying with the same input will help


# Known codes — mirror these on the client (job-errors.ts).
CODES = {
    "billing_exhausted",
    "invalid_credentials",
    "rate_limited",
    "model_overloaded",
    "context_too_long",
    "timeout",
    "network",
    "content_filtered",
    "model_not_found",
    "unknown",
}


# Provider detection — error messages carry distinct markers we can match on.
_PROVIDER_MARKERS = [
    ("anthropic", re.compile(r"anthropic|claude", re.IGNORECASE)),
    ("openai", re.compile(r"openai|gpt-", re.IGNORECASE)),
    ("google", re.compile(r"google|gemini|generativelanguage|generative_language", re.IGNORECASE)),
    ("mistral", re.compile(r"mistral", re.IGNORECASE)),
]


def _detect_provider(text: str) -> str | None:
    for name, pat in _PROVIDER_MARKERS:
        if pat.search(text):
            return name
    return None


def classify(exc: BaseException | str) -> ClassifiedError:
    """Turn a raw exception (or its stringified form) into a ClassifiedError."""
    text = str(exc) if not isinstance(exc, str) else exc
    lower = text.lower()
    provider = _detect_provider(text)

    # ── Billing / quota ──────────────────────────────────────────────────
    if any(
        m in lower
        for m in (
            "credit balance is too low",
            "quota exceeded",
            "insufficient_quota",
            "billing",
            "you exceeded your current quota",
            "insufficient funds",
        )
    ):
        prov_name = (provider or "your LLM provider").capitalize()
        return ClassifiedError(
            code="billing_exhausted",
            title=f"{prov_name} credits exhausted",
            message=(
                f"Your {prov_name} account is out of credits, so the agent can't "
                "make API calls."
            ),
            hint=(
                "Switch to a different model (e.g. Gemini) from the AI model "
                "picker, or add credits to your provider account and retry."
            ),
            provider=provider,
            retryable=False,
        )

    # ── Auth ─────────────────────────────────────────────────────────────
    if any(
        m in lower
        for m in (
            "invalid api key",
            "invalid_api_key",
            "incorrect api key",
            "unauthorized",
            "authentication failed",
            "401",
            "missing anthropic api key",
        )
    ):
        prov_name = (provider or "your LLM provider").capitalize()
        return ClassifiedError(
            code="invalid_credentials",
            title=f"{prov_name} key invalid or missing",
            message=(
                f"The agent couldn't authenticate with {prov_name}. The key is "
                "missing, expired, or rejected."
            ),
            hint=(
                "Open Settings → API Keys, re-paste the provider key, then retry."
            ),
            provider=provider,
            retryable=False,
        )

    # ── Rate limit / overload ────────────────────────────────────────────
    if any(
        m in lower
        for m in (
            "rate limit",
            "rate_limit",
            "too many requests",
            "429",
            "tpm limit",
            "rpm limit",
        )
    ):
        return ClassifiedError(
            code="rate_limited",
            title="Hit a rate limit",
            message=(
                "The model is rejecting requests because we're sending them too "
                "fast for the plan tier."
            ),
            hint="Wait ~30 seconds and retry, or switch to a different model.",
            provider=provider,
            retryable=True,
        )
    if any(
        m in lower
        for m in (
            "overloaded",
            "529",
            "service unavailable",
            "model is currently overloaded",
        )
    ):
        return ClassifiedError(
            code="model_overloaded",
            title="Model temporarily overloaded",
            message=(
                "The provider is overloaded right now and refused the request."
            ),
            hint="Retry in a minute, or pick a different model.",
            provider=provider,
            retryable=True,
        )

    # ── Context length ───────────────────────────────────────────────────
    if any(
        m in lower
        for m in (
            "maximum context length",
            "context_length_exceeded",
            "tokens in the messages",
            "prompt is too long",
            "max_tokens",
        )
    ):
        return ClassifiedError(
            code="context_too_long",
            title="Prompt too long for this model",
            message=(
                "The combined prompt + reference content exceeded what the model "
                "can fit in its context window."
            ),
            hint=(
                "Reduce the number of slides, trim reference files, or switch to "
                "a model with a larger context (e.g. Gemini 2.5 Pro)."
            ),
            provider=provider,
            retryable=False,
        )

    # ── Network / timeout ────────────────────────────────────────────────
    if any(m in lower for m in ("timed out", "timeout", "etimedout", "deadline")):
        return ClassifiedError(
            code="timeout",
            title="Request timed out",
            message="The LLM didn't respond in time.",
            hint="Retry — this usually clears on a second attempt.",
            provider=provider,
            retryable=True,
        )
    if any(m in lower for m in ("connection refused", "econnreset", "network error", "dns")):
        return ClassifiedError(
            code="network",
            title="Network error reaching the model",
            message="Couldn't talk to the LLM provider over the network.",
            hint="Check your connection, then retry.",
            provider=provider,
            retryable=True,
        )

    # ── Content filtered / safety ────────────────────────────────────────
    if any(
        m in lower
        for m in (
            "safety",
            "content filter",
            "blocked by safety",
            "harm_category",
            "filtered for safety",
        )
    ):
        return ClassifiedError(
            code="content_filtered",
            title="Prompt blocked by model safety filter",
            message=(
                "The provider's safety classifier flagged the prompt or response."
            ),
            hint="Rephrase the prompt avoiding sensitive topics, or try a different model.",
            provider=provider,
            retryable=False,
        )

    # ── Bad model name ───────────────────────────────────────────────────
    if any(
        m in lower
        for m in (
            "model not found",
            "model_not_found",
            "unknown model",
            "no such model",
            "404",
        )
    ):
        return ClassifiedError(
            code="model_not_found",
            title="Model not available",
            message="The chosen model doesn't exist (or your account can't access it).",
            hint="Pick a different model from the AI model picker.",
            provider=provider,
            retryable=False,
        )

    # ── Fallback ─────────────────────────────────────────────────────────
    # Trim to keep the wire payload reasonable; the full text already lives in
    # the worker log.
    snippet = text[:240].strip()
    return ClassifiedError(
        code="unknown",
        title="Generation failed",
        message=snippet or "Something went wrong while generating the deck.",
        hint="Try again. If it keeps failing, switch models or shrink the prompt.",
        provider=provider,
        retryable=True,
    )


def to_payload(err: ClassifiedError) -> dict:
    """Wire format consumed by the web app's progress SSE stream."""
    return {
        "errorCode": err.code,
        "errorTitle": err.title,
        "errorMessage": err.message,
        "errorHint": err.hint,
        "errorProvider": err.provider,
        "errorRetryable": err.retryable,
    }
