import re

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..config import get_settings
from ..deps import User, require_role
from ..pipelines.ingest import SourceDoc
from ..pipelines.ocr import OcrError, read_notice
from ..rag.retriever import IndexedChunk, get_retriever
from ..schemas import Chunk, IngestRequest, IngestResponse

router = APIRouter(prefix="/v1/admin", tags=["admin"])


def _slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return s[:60] or "source"


def _vec(v):
    return None if v is None else "[" + ",".join(f"{x:.6f}" for x in v) + "]"


async def _persist(doc: SourceDoc, chunks: list[IndexedChunk]) -> None:
    """Mirror the source and its chunks into Supabase so they survive restarts."""
    s = get_settings()
    if not s.supabase_enabled:
        return
    base = s.supabase_url.rstrip("/") + "/rest/v1"
    h = {"apikey": s.supabase_service_key, "Authorization": f"Bearer {s.supabase_service_key}",
         "Content-Type": "application/json", "Accept-Profile": "janseva",
         "Content-Profile": "janseva"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{base}/sources", params={"on_conflict": "slug"},
                              headers={**h, "Prefer": "resolution=merge-duplicates,"
                                                      "return=representation"},
                              json={"slug": doc.id, "title": doc.title, "url": doc.url,
                                    "kind": doc.meta.get("kind", "service"),
                                    "language": doc.meta.get("language", "en"),
                                    "content": doc.body})
        r.raise_for_status()
        source_uuid = r.json()[0]["id"]
        await client.delete(f"{base}/doc_chunks", params={"source_id": f"eq.{source_uuid}"},
                            headers=h)
        r = await client.post(f"{base}/doc_chunks", headers={**h, "Prefer": "return=minimal"},
                              json=[{"id": c.id, "source_id": source_uuid, "content": c.content,
                                     "ordinal": c.ordinal, "embedding": _vec(c.vector)}
                                    for c in chunks])
        r.raise_for_status()


def _out(doc: SourceDoc, chunks: list[IndexedChunk]) -> IngestResponse:
    return IngestResponse(source_id=doc.id, chunks=[
        Chunk(id=c.id, source_id=doc.id, content=c.content, ordinal=c.ordinal) for c in chunks])


@router.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest, user: User = Depends(require_role("admin"))):
    doc = SourceDoc(id=_slug(req.title), title=req.title, body=req.content,
                    meta={"source_url": req.url, "kind": req.kind, "language": req.language})
    chunks = await get_retriever().add(doc)
    await _persist(doc, chunks)
    return _out(doc, chunks)


@router.post("/ingest/file", response_model=IngestResponse)
async def ingest_file(file: UploadFile = File(...), title: str = Form(...),
                      url: str | None = Form(None), user: User = Depends(require_role("admin"))):
    data = await file.read()
    try:
        text = (await read_notice(data, file.content_type or "text/plain")).text
    except OcrError as e:
        raise HTTPException(422, str(e)) from e
    if len(text) < 20:
        raise HTTPException(422, "No readable text in that file")
    return await ingest(IngestRequest(title=title, content=text, url=url), user)


@router.get("/sources")
async def sources(user: User = Depends(require_role("admin"))):
    r = get_retriever()
    counts: dict[str, int] = {}
    for c in r.chunks:
        counts[c.source.id] = counts.get(c.source.id, 0) + 1
    return [{"id": d.id, "title": d.title, "url": d.url, "chunks": counts.get(d.id, 0)}
            for d in r.sources.values()]


@router.get("/sources/{source_id}/chunks", response_model=list[Chunk])
async def source_chunks(source_id: str, user: User = Depends(require_role("admin"))):
    return [Chunk(id=c.id, source_id=source_id, content=c.content, ordinal=c.ordinal)
            for c in get_retriever().chunks if c.source.id == source_id]


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str, user: User = Depends(require_role("admin"))):
    r = get_retriever()
    if source_id not in r.sources:
        raise HTTPException(404, "Source not found")
    r.remove(source_id)
    return {"deleted": source_id}


@router.post("/reindex")
async def reindex(user: User = Depends(require_role("admin"))):
    """Re-embed every source (e.g. after switching EMBED_PROVIDER)."""
    r = get_retriever()
    docs = list(r.sources.values())
    for d in docs:
        await r.add(d)
    return {"sources": len(docs), "chunks": len(r.chunks)}
