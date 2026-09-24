from functools import lru_cache

from fastapi import APIRouter, Depends

from ..config import get_settings
from ..deps import User, current_user
from ..llm.base import LLMUnavailable
from ..llm.gateway import get_gateway
from ..pipelines.schemes import load_schemes, match
from ..schemas import SchemeAnswers, SchemeMatch, SchemeMatchResponse

router = APIRouter(prefix="/v1", tags=["sahayak"])


@lru_cache
def schemes() -> list[dict]:
    return load_schemes(get_settings().data_dir / "schemes")


def _t(s: dict, key: str, lang: str):
    return s.get(f"{key}_{lang}") or s.get(key)


EXPLAIN = """In 1-2 very simple sentences of {lang}, tell a citizen why this government scheme
fits them and what they get. Use ONLY the given facts. Return ONLY JSON: {{"text": "..."}}"""


@router.get("/schemes")
async def list_schemes():
    return [{"id": s["id"], "name": s["name"], "name_hi": s.get("name_hi"),
             "benefit": s.get("benefit")} for s in schemes()]


@router.post("/schemes/match", response_model=SchemeMatchResponse)
async def match_schemes(a: SchemeAnswers, user: User = Depends(current_user)):
    results = match(schemes(), a)
    gateway = get_gateway()
    provider = "rules"
    out: list[SchemeMatch] = []
    for i, r in enumerate(results):
        s = r.scheme
        benefit = _t(s, "benefit", a.language)
        explanation = " ".join(r.reasons[:2]) + ("." if r.reasons else "")
        # Only the top few get a model-written explanation, to keep latency low.
        if i < 3 and gateway.providers:
            lang = "Hindi (Devanagari)" if a.language == "hi" else "English"
            try:
                data, provider = await gateway.chat_json([
                    {"role": "system", "content": EXPLAIN.format(lang=lang)},
                    {"role": "user", "content": f"Scheme: {_t(s, 'name', a.language)}. "
                                                f"Benefit: {benefit}. Why eligible: {r.reasons}. "
                                                f"Still to check: {r.checks}"}])
                if isinstance(data.get("text"), str) and data["text"].strip():
                    explanation = data["text"].strip()
            except LLMUnavailable:
                pass
        out.append(SchemeMatch(
            id=s["id"], name=_t(s, "name", a.language), status=r.status, reasons=r.reasons,
            checks=r.checks, benefit=benefit, documents=_t(s, "documents", a.language) or [],
            apply_url=s.get("apply_url"), source_url=s.get("source_url"),
            explanation=explanation))
    return SchemeMatchResponse(matches=out, evaluated=len(schemes()), provider=provider)
