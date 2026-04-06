from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI, AzureChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_mistralai import ChatMistralAI
import structlog

from app.models import LLMConfig
from app.config import settings

logger = structlog.get_logger()

# Map provider to the settings attribute holding the fallback key
SETTINGS_KEY_MAP = {
    "openai": "openai_api_key",
    "anthropic": "anthropic_api_key",
    "google": "google_api_key",
    "mistral": "mistral_api_key",
}


def _resolve_api_key(config: LLMConfig) -> str | None:
    """Get API key from config, falling back to app settings (.env)."""
    if config.api_key:
        return config.api_key
    attr = SETTINGS_KEY_MAP.get(config.provider, "")
    key = getattr(settings, attr, "") if attr else ""
    if key:
        logger.info("using_settings_api_key", provider=config.provider)
    return key or None


def get_model(config: LLMConfig) -> BaseChatModel:
    api_key = _resolve_api_key(config)

    logger.info(
        "creating_llm",
        provider=config.provider,
        model=config.model,
        has_key=bool(api_key),
    )

    match config.provider:
        case "openai":
            return ChatOpenAI(
                model=config.model,
                api_key=api_key,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
            )
        case "azure":
            return AzureChatOpenAI(
                azure_deployment=config.model,
                azure_endpoint=config.base_url or "",
                api_key=api_key,
                api_version="2024-06-01",
                temperature=config.temperature,
                max_tokens=config.max_tokens,
            )
        case "anthropic":
            return ChatAnthropic(
                model=config.model,
                api_key=api_key,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
            )
        case "google":
            return ChatGoogleGenerativeAI(
                model=config.model,
                google_api_key=api_key,
                temperature=config.temperature,
                max_output_tokens=config.max_tokens,
            )
        case "mistral":
            return ChatMistralAI(
                model=config.model,
                api_key=api_key,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
            )
        case "custom":
            return ChatOpenAI(
                model=config.model,
                base_url=config.base_url,
                api_key=api_key,
                temperature=config.temperature,
                max_tokens=config.max_tokens,
            )
        case _:
            raise ValueError(f"Unsupported LLM provider: {config.provider}")
