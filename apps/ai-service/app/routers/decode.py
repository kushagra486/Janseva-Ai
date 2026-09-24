from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from ..deps import User, check_owned_path, current_user, download_object
from ..llm.gateway import get_gateway
from ..pipelines import explain, extract
from ..pipelines.ocr import OcrError, read_notice
from ..privacy.pii_mask import mask_pii
from ..rag.reranker import rerank
from ..rag.retriever import get_retriever
from ..schemas import Citation, DecodeRequest, DecodeResponse, Lang

router = APIRouter(prefix="/v1", tags=["sahayak"])

MAX_BYTES = 10 * 1024 * 1024
LOW_CONFIDENCE = 0.7
TYPE_QUERY = {
    "property_tax": "pay property house tax lucknow nagar nigam",
    "water_bill": "pay water tax bill jal kal lucknow",
    "electricity_bill": "pay electricity bill uppcl",
    "traffic_challan": "pay traffic e-challan",
    "building_violation": "building map approval lda",
    "encroachment": "encroachment notice nagar nigam",
}


async def decode_text(raw_text: str, language: Lang, ocr_quality: float) -> DecodeResponse:
    if len(raw_text.strip()) < 15:
        raise HTTPException(422, "Could not read enough text. Retake the photo in good light, "
                                 "flat, with the whole notice in frame.")
    masked, _ = mask_pii(raw_text)
    gateway = get_gateway()
    rules = extract.rules_extract(masked)
    llm = await extract.llm_extract(gateway, masked)
    fields = extract.merge(rules, llm[0] if llm else None)
    provider = llm[1] if llm else "rules"

    query = TYPE_QUERY.get(fields.notice_type.value or "", "") or masked[:300]
    hits = rerank(await get_retriever().search(query, k=6))
    guide = "\n\n".join(h.chunk.content for h in hits)
    citations = [Citation(title=h.chunk.source.title, url=h.chunk.source.url,
                          source_id=h.chunk.source.id) for h in hits]

    exp = explain.template_explain(fields, language)
    better = await explain.llm_explain(gateway, fields, guide, language, exp)
    if better:
        exp = better[0]

    key_fields = ["notice_type", "authority", "amount", "deadline"]
    confs = {k: getattr(fields, k).confidence for k in key_fields
             if getattr(fields, k).value is not None}
    low = [k for k in key_fields if getattr(fields, k).value is None
           or getattr(fields, k).confidence < LOW_CONFIDENCE]
    overall = (sum(confs.values()) / len(key_fields)) * (0.5 + 0.5 * ocr_quality)
    return DecodeResponse(ocr_text=raw_text, masked_text=masked, fields=fields, explanation=exp,
                          confidence=round(overall, 2), low_confidence_fields=low,
                          citations=citations, provider=provider,
                          disclaimer=explain.DISCLAIMER[language])


@router.post("/decode", response_model=DecodeResponse)
async def decode(req: DecodeRequest, user: User = Depends(current_user)):
    """Decode a notice from pasted text or a file already uploaded to Supabase Storage."""
    if req.text:
        return await decode_text(req.text, req.language, 1.0)
    if not req.file_path:
        raise HTTPException(422, "Provide text or file_path")
    check_owned_path(user, req.file_path)
    data, ctype = await download_object("notices", req.file_path)
    return await _decode_bytes(data, ctype, req.language)


@router.post("/decode/upload", response_model=DecodeResponse)
async def decode_upload(file: UploadFile = File(...), language: Lang = Form("hi"),
                        user: User = Depends(current_user)):
    """Decode a notice photo or PDF sent directly (demo mode, or when not storing the file)."""
    data = await file.read()
    return await _decode_bytes(data, file.content_type or "application/octet-stream", language)


async def _decode_bytes(data: bytes, ctype: str, language: Lang) -> DecodeResponse:
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large (max 10 MB)")
    try:
        ocr = await read_notice(data, ctype)
    except OcrError as e:
        raise HTTPException(422, str(e)) from e
    return await decode_text(ocr.text, language, ocr.quality)


