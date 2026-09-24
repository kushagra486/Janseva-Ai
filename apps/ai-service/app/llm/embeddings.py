"""Embeddings for retrieval and duplicate detection.

`ollama` uses BGE-M3 (multilingual, handles Hindi and Hinglish). `hash` is a deterministic
character n-gram hashing embedding: no model needed, good enough for near-duplicate text and
keyword-heavy retrieval, and used in tests and fully offline demos.
"""

import hashlib
import logging
import re

import numpy as np

from ..config import get_settings
from .base import LLMError
from .ollama import OllamaProvider

log = logging.getLogger(__name__)

_TOKEN = re.compile(r"[\wऀ-ॿ]+", re.U)


def normalize(text: str) -> str:
    return " ".join(_TOKEN.findall(text.lower()))


def hash_embed(text: str, dim: int) -> list[float]:
    vec = np.zeros(dim, dtype=np.float32)
    norm = normalize(text)
    for word in norm.split():
        feats = [f"w:{word}"]
        padded = f"#{word}#"
        feats += [f"c:{padded[i:i + 3]}" for i in range(max(1, len(padded) - 2))]
        for f in feats:
            h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "little")
            weight = 2.0 if f.startswith("w:") else 1.0
            vec[h % dim] += weight if (h >> 63) & 1 else -weight
    n = np.linalg.norm(vec)
    return (vec / n).tolist() if n else vec.tolist()


def cosine(a: list[float], b: list[float]) -> float:
    va, vb = np.asarray(a), np.asarray(b)
    d = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(va @ vb / d) if d else 0.0


async def embed(texts: list[str]) -> list[list[float]]:
    """Embed texts with the configured provider.

    Raises LLMError if the model provider is down. Vectors from different providers are not
    comparable, so we never silently mix them; callers fall back to keyword scoring instead.
    """
    s = get_settings()
    if s.embed_provider == "ollama":
        return await OllamaProvider(s.ollama_url, s.ollama_model, s.llm_timeout_s).embed(
            s.ollama_embed_model, texts)
    return [hash_embed(t, s.embed_dim) for t in texts]


async def try_embed(texts: list[str]) -> list[list[float]] | None:
    try:
        return await embed(texts)
    except LLMError as e:
        log.warning("embeddings unavailable: %s", e)
        return None
