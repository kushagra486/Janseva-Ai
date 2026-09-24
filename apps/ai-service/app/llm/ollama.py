import json
from collections.abc import AsyncIterator

import httpx

from .base import LLMError


class OllamaProvider:
    name = "ollama"

    def __init__(self, url: str, model: str, timeout: float):
        self.url = url.rstrip("/")
        self.model = model
        self.timeout = timeout

    async def chat(self, messages, *, json_mode=False, temperature=0.2) -> str:
        body = {"model": self.model, "messages": messages, "stream": False,
                "options": {"temperature": temperature}}
        if json_mode:
            body["format"] = "json"
        try:
            async with httpx.AsyncClient(timeout=self.timeout * 3) as client:
                r = await client.post(f"{self.url}/api/chat", json=body)
                r.raise_for_status()
                return r.json()["message"]["content"]
        except (httpx.HTTPError, KeyError) as e:
            raise LLMError(f"ollama: {e}") from e

    async def stream(self, messages, *, temperature=0.2) -> AsyncIterator[str]:
        body = {"model": self.model, "messages": messages, "stream": True,
                "options": {"temperature": temperature}}
        try:
            async with httpx.AsyncClient(timeout=self.timeout * 3) as client:
                async with client.stream("POST", f"{self.url}/api/chat", json=body) as r:
                    r.raise_for_status()
                    async for line in r.aiter_lines():
                        if line.strip():
                            piece = json.loads(line).get("message", {}).get("content")
                            if piece:
                                yield piece
        except (httpx.HTTPError, ValueError) as e:
            raise LLMError(f"ollama stream: {e}") from e

    async def embed(self, model: str, texts: list[str]) -> list[list[float]]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout * 3) as client:
                r = await client.post(f"{self.url}/api/embed",
                                      json={"model": model, "input": texts})
                r.raise_for_status()
                return r.json()["embeddings"]
        except (httpx.HTTPError, KeyError) as e:
            raise LLMError(f"ollama embed: {e}") from e

    async def healthy(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"{self.url}/api/tags")
                return r.status_code == 200
        except httpx.HTTPError:
            return False
