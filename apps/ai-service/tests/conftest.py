import os

# Force demo mode with no models so tests are deterministic and offline.
os.environ.update({"LLM_PROVIDERS": "", "EMBED_PROVIDER": "hash", "SUPABASE_URL": "",
                   "SUPABASE_SERVICE_KEY": "", "SUPABASE_JWT_SECRET": ""})

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.llm.gateway import set_gateway  # noqa: E402
from app.store import set_store  # noqa: E402


@pytest.fixture
def client():
    set_store(None)
    set_gateway(None)
    from app.main import app
    with TestClient(app) as c:
        yield c
    set_store(None)
    set_gateway(None)


OFFICER = {"X-Demo-Role": "officer", "X-Demo-User": "officer-1"}
ADMIN = {"X-Demo-Role": "admin", "X-Demo-User": "admin-1"}
