from ..config import get_settings
from .base import Store
from .memory import MemoryStore

_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        s = get_settings()
        if s.supabase_enabled:
            from .supabase import SupabaseStore
            _store = SupabaseStore(s.supabase_url, s.supabase_service_key)
        else:
            _store = MemoryStore()
    return _store


def set_store(store: Store | None) -> None:
    global _store
    _store = store
