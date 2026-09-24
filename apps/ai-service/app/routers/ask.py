import json
import re

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ..deps import User, current_user
from ..llm.base import LLMUnavailable
from ..llm.gateway import get_gateway
from ..privacy.pii_mask import mask_pii
from ..rag.reranker import rerank
from ..rag.retriever import Hit, get_retriever
from ..schemas import AskRequest, AskResponse, Citation, Lang

router = APIRouter(prefix="/v1", tags=["sahayak"])

HINGLISH = re.compile(r"\b(kaise|kya|kahan|kitna|karein|karen|kare|hai|hota|milega|chahiye|"
                      r"banwana|banega|mera|meri|apna|kab)\b", re.I)

SYSTEM = """You are JANSEVA, a helpful guide to government services in Lucknow and Uttar Pradesh.
Answer ONLY from the CONTEXT. If the context does not contain the answer, say you don't know
and suggest the office to contact. Give short numbered steps, the documents needed, fees and
time if the context has them, and the official link. Cite sources inline as [1], [2] matching
the context numbers. Reply in {lang_hint}. Keep it under 180 words."""

NO_ANSWER = {
    "hi": "माफ़ कीजिए, इस सवाल की पक्की जानकारी हमारे पास नहीं है। कृपया नगर निगम लखनऊ के "
          "हेल्पलाइन या नज़दीकी जन सेवा केंद्र (CSC) से संपर्क करें।",
    "en": "Sorry, I don't have verified information on that yet. Please contact the Lucknow "
          "Nagar Nigam helpline or your nearest Jan Seva Kendra (CSC).",
}


def detect(question: str) -> tuple[Lang, str]:
    dev = sum(1 for ch in question if "ऀ" <= ch <= "ॿ")
    if dev > 2:
        return "hi", "simple Hindi in Devanagari script"
    if HINGLISH.search(question):
        return "hi", "simple Hinglish (Hindi written in Roman script), like the question"
    return "en", "simple English"


def context_block(hits: list[Hit]) -> str:
    return "\n\n".join(f"[{i}] {h.chunk.source.title} ({h.chunk.source.url or 'no link'})\n"
                       f"{h.chunk.content}" for i, h in enumerate(hits, 1))


def extractive_answer(hits: list[Hit], lang: Lang) -> str:
    """No-model fallback: return the most relevant guide section verbatim, with its link."""
    top = hits[0].chunk
    head = "यह जानकारी आधिकारिक गाइड से है:" if lang == "hi" else "From the official guide:"
    body = top.content.split("\n", 1)[-1].strip()
    link = f"\n\n{top.source.url}" if top.source.url else ""
    return f"{head} [1]\n\n{body}{link}"


@router.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest, user: User = Depends(current_user)):
    masked, _ = mask_pii(req.question)
    lang, hint = detect(masked)
    if req.language:
        lang = req.language
        hint = "simple Hindi in Devanagari script" if lang == "hi" else "simple English"
    hits = rerank(await get_retriever().search(masked, k=8), max_sources=3)
    citations = [Citation(title=h.chunk.source.title, url=h.chunk.source.url,
                          source_id=h.chunk.source.id) for h in hits]
    messages = [{"role": "system", "content": SYSTEM.format(lang_hint=hint)},
                {"role": "user", "content": f"CONTEXT:\n{context_block(hits)}\n\n"
                                            f"QUESTION: {masked}"}]
    gateway = get_gateway()

    if req.stream:
        async def events():
            yield f"event: citations\ndata: {json.dumps([c.model_dump() for c in citations])}\n\n"
            if not hits:
                yield f"data: {json.dumps(NO_ANSWER[lang])}\n\n"
            else:
                try:
                    async for piece, _ in gateway.stream(messages):
                        yield f"data: {json.dumps(piece)}\n\n"
                except LLMUnavailable:
                    yield f"data: {json.dumps(extractive_answer(hits, lang))}\n\n"
            yield "event: done\ndata: {}\n\n"
        return StreamingResponse(events(), media_type="text/event-stream")

    if not hits:
        return AskResponse(answer=NO_ANSWER[lang], citations=[], language=lang, provider="rules")
    try:
        answer, provider = await gateway.chat(messages)
    except LLMUnavailable:
        answer, provider = extractive_answer(hits, lang), "rules"
    return AskResponse(answer=answer.strip(), citations=citations, language=lang,
                       provider=provider)
