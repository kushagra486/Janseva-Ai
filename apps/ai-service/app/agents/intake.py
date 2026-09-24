"""Intake agent: normalise the report text, detect language and classify the category."""

import re

from ..llm.base import LLMUnavailable
from ..llm.gateway import LLMGateway
from ..schemas import Category, Lang

LEXICON: dict[str, list[str]] = {
    "waste": ["garbage", "kachra", "kooda", "kuda", "trash", "waste", "dump", "dustbin", "smell",
              "कचरा", "कूड़ा", "कूडा", "गंदगी", "कूड़ेदान", "badbu", "बदबू", "safai", "सफाई"],
    "water_drainage": ["drain", "nala", "naala", "nali", "sewer", "sewage", "overflow", "water",
                       "leak", "pipeline", "waterlogging", "flood", "pani", "नाला", "नाली", "सीवर",
                       "पानी", "जलभराव", "लीकेज", "पाइपलाइन", "gutter", "गटर", "manhole", "मैनहोल"],
    "roads": ["pothole", "road", "gaddha", "gadda", "sadak", "footpath", "broken road", "crack",
              "गड्ढा", "गड्ढे", "सड़क", "सडक", "फुटपाथ", "speed breaker", "divider"],
    "streetlights": ["streetlight", "street light", "light", "lamp", "pole", "andhera", "batti",
                     "स्ट्रीट लाइट", "लाइट", "बत्ती", "अंधेरा", "खंभा", "wire", "तार", "करंट",
                     "current"],
    "public_infra": ["park", "toilet", "bench", "bus stop", "tree", "wall", "bridge", "signal",
                     "पार्क", "शौचालय", "पेड़", "पुल", "दीवार", "सिग्नल", "stray", "आवारा"],
}
_WORD = re.compile(r"[\wऀ-ॿ]+(?:\s[\wऀ-ॿ]+)?", re.U)


def detect_language(text: str) -> Lang:
    dev = sum(1 for ch in text if "ऀ" <= ch <= "ॿ")
    letters = sum(1 for ch in text if ch.isalpha())
    return "hi" if letters and dev / letters > 0.3 else "en"


def classify(text: str) -> tuple[Category, float]:
    low = text.lower()
    scores = {cat: sum(low.count(w) for w in words) for cat, words in LEXICON.items()}
    # "light" is a substring of "streetlight"; "water" appears in waterlogging. Both fine.
    best = max(scores, key=scores.get)
    total = sum(scores.values())
    if scores[best] == 0:
        return "public_infra", 0.3
    return best, round(min(0.95, 0.5 + 0.5 * scores[best] / total), 2)


CLASSIFY_PROMPT = """Classify a civic complaint from an Indian city. Categories:
waste, water_drainage, roads, streetlights, public_infra.
Return ONLY JSON: {"category": "...", "summary_en": "one short English sentence"}"""


async def llm_classify(gateway: LLMGateway, masked_text: str) -> dict | None:
    try:
        data, _ = await gateway.chat_json([
            {"role": "system", "content": CLASSIFY_PROMPT},
            {"role": "user", "content": masked_text[:2000]}])
    except LLMUnavailable:
        return None
    return data if data.get("category") in LEXICON else None
