"""Runtime configuration, read from environment variables (or a .env file)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Comma-separated provider order for the LLM gateway. The gateway tries each in turn
    # and falls back to deterministic rules when every provider fails.
    llm_providers: str = "groq,ollama"
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    groq_stt_model: str = "whisper-large-v3"
    groq_vision_model: str = "meta-llama/llama-4-scout-17b-16e-instruct"
    # Sending an unmasked image to a hosted model is a privacy trade-off, so it is opt-in.
    allow_vision_fallback: bool = False
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"
    llm_timeout_s: float = 20.0

    # "ollama" uses BGE-M3; "hash" is a dependency-free fallback for tests and offline demos.
    embed_provider: str = "hash"
    ollama_embed_model: str = "bge-m3"
    embed_dim: int = 1024

    # Supabase. When unset the service runs in demo mode with an in-memory store.
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_jwt_secret: str = ""

    data_dir: Path = REPO_ROOT / "data"
    cors_origins: str = "http://localhost:3000"

    # Clustering thresholds
    cluster_radius_m: float = 150.0
    cluster_min_score: float = 0.55

    @property
    def providers(self) -> list[str]:
        return [p.strip() for p in self.llm_providers.split(",") if p.strip()]

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
