from collections.abc import AsyncIterator
from typing import Protocol


class LLMError(Exception):
    """A provider failed (network, rate limit, bad output)."""


class LLMUnavailable(LLMError):
    """Every configured provider failed. Callers fall back to deterministic rules."""


class ChatProvider(Protocol):
    name: str

    async def chat(self, messages: list[dict], *, json_mode: bool = False,
                   temperature: float = 0.2) -> str: ...

    def stream(self, messages: list[dict], *, temperature: float = 0.2
               ) -> AsyncIterator[str]: ...

    async def healthy(self) -> bool: ...
