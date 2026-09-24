import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import get_settings
from .rag.retriever import get_retriever
from .routers import admin, ask, decode, health, reports, schemes, stt
from .store import get_store

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("janseva")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    n = await get_retriever().load_dir(s.data_dir / "services")
    log.info("indexed %d chunks from %s", n, s.data_dir / "services")
    store = get_store()
    if store.kind == "memory":
        from .demo_seed import seed
        await seed(store)
        log.info("demo mode: in-memory store seeded")
    yield


app = FastAPI(title="JANSEVA AI service", version=__version__, lifespan=lifespan)
app.add_middleware(CORSMiddleware,
                   allow_origins=[o.strip() for o in get_settings().cors_origins.split(",")],
                   allow_methods=["*"], allow_headers=["*"])
for r in (decode, ask, schemes, stt, reports, admin, health):
    app.include_router(r.router)
