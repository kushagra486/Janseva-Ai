from fastapi import APIRouter

from .. import __version__
from ..config import get_settings
from ..llm.gateway import get_gateway
from ..rag.retriever import get_retriever
from ..schemas import Health
from ..store import get_store

router = APIRouter(tags=["health"])


@router.get("/health", response_model=Health)
async def health():
    providers = await get_gateway().health()
    ok = any(providers.values())
    return Health(status="ok" if ok else "degraded", providers=providers,
                  store=get_store().kind, embed_provider=get_settings().embed_provider,
                  corpus_chunks=len(get_retriever().chunks), version=__version__)
