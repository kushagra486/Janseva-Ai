import json
from collections.abc import AsyncIterator

import httpx

from .base import LLMError

GROQ_BASE = "https://api.groq.com/openai/v1"


class GroqProvider:
    name = "groq"

    def __init__(self, api_key: str, model: str, stt_model: str, timeout: float):
        self.api_key = api_key
        self.model = model
        self.stt_model = stt_model
        self.timeout = timeout

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def chat(self, messages, *, json_mode=False, temperature=0.2) -> str:
        if not self.api_key:
            raise LLMError("GROQ_API_KEY not set")
        body = {"model": self.model, "messages": messages, "temperature": temperature}
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.post(f"{GROQ_BASE}/chat/completions", json=body,
                                      headers=self._headers)
                r.raise_for_status()
                return r.json()["choices"][0]["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError) as e:
            raise LLMError(f"groq: {e}") from e

    async def stream(self, messages, *, temperature=0.2) -> AsyncIterator[str]:
        if not self.api_key:
            raise LLMError("GROQ_API_KEY not set")
        body = {"model": self.model, "messages": messages, "temperature": temperature,
                "stream": True}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", f"{GROQ_BASE}/chat/completions", json=body,
                                         headers=self._headers) as r:
                    r.raise_for_status()
                    async for line in r.aiter_lines():
                        if not line.startswith("data: ") or line == "data: [DONE]":
                            continue
                        delta = json.loads(line[6:])["choices"][0]["delta"].get("content")
                        if delta:
                            yield delta
        except (httpx.HTTPError, KeyError, ValueError) as e:
            raise LLMError(f"groq stream: {e}") from e

    async def transcribe(self, audio: bytes, filename: str) -> dict:
        if not self.api_key:
            raise LLMError("GROQ_API_KEY not set")
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.post(
                    f"{GROQ_BASE}/audio/transcriptions",
                    headers=self._headers,
                    data={"model": self.stt_model, "response_format": "verbose_json"},
                    files={"file": (filename, audio)},
                )
                r.raise_for_status()
                data = r.json()
                return {"text": data.get("text", "").strip(), "language": data.get("language")}
        except httpx.HTTPError as e:
            raise LLMError(f"groq stt: {e}") from e

    async def healthy(self) -> bool:
        if not self.api_key:
            return False
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{GROQ_BASE}/models", headers=self._headers)
                return r.status_code == 200
        except httpx.HTTPError:
            return False
