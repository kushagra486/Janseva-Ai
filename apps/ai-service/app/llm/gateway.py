"""One entry point for every model call.

Providers are tried in the order given by LLM_PROVIDERS. If one fails (rate limit, timeout,
invalid JSON) the next is tried. If all fail, LLMUnavailable is raised and each pipeline
falls back to its deterministic rule-based path, so the demo keeps working with no model.

Text is expected to be PII-masked by the caller before it reaches this module.
"""

import json
import logging
import re
from collections.abc import AsyncIterator

from ..config import Settings, get_settings
from .base import ChatProvider, LLMError, LLMUnavailable
from .groq import GroqProvider
from .ollama import OllamaProvider

log = logging.getLogger(__name__)


class LLMGateway:
    def __init__(self, providers: list[ChatProvider]):
        self.providers = providers

    @classmethod
    def from_settings(cls, s: Settings) -> "LLMGateway":
        providers: list[ChatProvider] = []
        for name in s.providers:
            if name == "groq" and s.groq_api_key:
                providers.append(GroqProvider(s.groq_api_key, s.groq_model, s.groq_stt_model,
                                              s.llm_timeout_s))
            elif name == "ollama":
                providers.append(OllamaProvider(s.ollama_url, s.ollama_model, s.llm_timeout_s))
        return cls(providers)

    def get(self, name: str):
        return next((p for p in self.providers if p.name == name), None)

    async def chat(self, messages: list[dict], *, temperature: float = 0.2) -> tuple[str, str]:
        """Returns (text, provider_name)."""
        errors = []
        for p in self.providers:
            try:
                return await p.chat(messages, temperature=temperature), p.name
            except LLMError as e:
                log.warning("provider %s failed: %s", p.name, e)
                errors.append(str(e))
        raise LLMUnavailable("; ".join(errors) or "no providers configured")

    async def chat_json(self, messages: list[dict]) -> tuple[dict, str]:
        """Like chat() but requires a JSON object; invalid JSON counts as a provider failure."""
        errors = []
        for p in self.providers:
            try:
                raw = await p.chat(messages, json_mode=True, temperature=0)
                return parse_json(raw), p.name
            except (LLMError, ValueError) as e:
                log.warning("provider %s failed json: %s", p.name, e)
                errors.append(str(e))
        raise LLMUnavailable("; ".join(errors) or "no providers configured")

    async def stream(self, messages: list[dict]) -> AsyncIterator[tuple[str, str]]:
        """Yields (piece, provider). Fails over only before the first piece is sent."""
        errors = []
        for p in self.providers:
            started = False
            try:
                async for piece in p.stream(messages):
                    started = True
                    yield piece, p.name
                return
            except LLMError as e:
                if started:
                    raise
                log.warning("provider %s failed stream: %s", p.name, e)
                errors.append(str(e))
        raise LLMUnavailable("; ".join(errors) or "no providers configured")

    async def health(self) -> dict[str, bool]:
        return {p.name: await p.healthy() for p in self.providers}


def parse_json(raw: str) -> dict:
    raw = raw.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", raw, re.S)
    if fence:
        raw = fence.group(1)
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in model output")
    obj = json.loads(raw[start:end + 1])
    if not isinstance(obj, dict):
        raise ValueError("model output is not a JSON object")
    return obj


_gateway: LLMGateway | None = None


def get_gateway() -> LLMGateway:
    global _gateway
    if _gateway is None:
        _gateway = LLMGateway.from_settings(get_settings())
    return _gateway


def set_gateway(g: LLMGateway | None) -> None:
    """Test hook."""
    global _gateway
    _gateway = g
