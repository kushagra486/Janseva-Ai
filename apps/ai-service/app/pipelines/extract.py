"""Extract structured fields from notice text.

Two paths that cross-check each other:
  * rules_extract: deterministic regexes for amounts, dates, authorities and notice types in
    Hindi and English. Always runs, needs no model.
  * llm_extract: the gateway returns strict JSON. Its values are only accepted when they are
    well-formed, and agreement with the rules path raises confidence.
"""

import re
from datetime import date

from ..llm.base import LLMUnavailable
from ..llm.gateway import LLMGateway
from ..privacy.pii_mask import to_ascii_digits
from ..schemas import Field_, NoticeFields

HI_MONTHS = {
    "जनवरी": 1, "फरवरी": 2, "फ़रवरी": 2, "मार्च": 3, "अप्रैल": 4, "मई": 5, "जून": 6,
    "जुलाई": 7, "अगस्त": 8, "सितंबर": 9, "सितम्बर": 9, "अक्टूबर": 10, "अक्तूबर": 10,
    "नवंबर": 11, "नवम्बर": 11, "दिसंबर": 12, "दिसम्बर": 12,
}
EN_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

AUTHORITIES = [
    (r"नगर\s*निगम\s*,?\s*लखनऊ|लखनऊ\s*नगर\s*निगम|lucknow\s+(?:nagar\s+nigam|municipal\s+corporation)"
     r"|nagar\s+nigam,?\s+lucknow", "Lucknow Nagar Nigam"),
    (r"जलकल\s*विभाग|jal\s*kal", "Jal Kal Vibhag, Lucknow"),
    (r"लखनऊ\s*विकास\s*प्राधिकरण|lucknow\s+development\s+authority|\bLDA\b",
     "Lucknow Development Authority"),
    (r"मध्यांचल\s*विद्युत|madhyanchal\s+vidyut|\bMVVNL\b|\bUPPCL\b|विद्युत\s*वितरण",
     "Madhyanchal Vidyut Vitran Nigam (UPPCL)"),
    (r"यातायात\s*पुलिस|traffic\s+police|e-?challan", "Traffic Police, Uttar Pradesh"),
    (r"तहसील|tehsil|तहसीलदार|tehsildar", "Tehsil office"),
    (r"न्यायालय|court\s+of|district\s+court", "Court"),
    (r"नगर\s*निगम|municipal\s+corporation|nagar\s+nigam", "Municipal Corporation"),
]

NOTICE_TYPES = [
    ("property_tax", r"गृहकर|गृह\s*कर|भवन\s*कर|property\s+tax|house\s+tax"),
    ("water_bill", r"जलकर|जल\s*कर|जल\s*मूल्य|water\s+(?:tax|bill|charges)|sewer"),
    ("electricity_bill", r"विद्युत\s*बिल|बिजली|electricity|kwh|यूनिट|units\s+consumed"),
    ("encroachment", r"अतिक्रमण|encroachment"),
    ("building_violation", r"अवैध\s*निर्माण|मानचित्र|unauthori[sz]ed\s+construction|"
                           r"sanctioned\s+(?:map|plan)|demolition|ध्वस्तीकरण"),
    ("traffic_challan", r"चालान|challan|motor\s+vehicles\s+act|मोटर\s*यान"),
    ("court_summons", r"समन|summons|उपस्थित\s*हों|appear\s+before"),
]

AMOUNT_RE = re.compile(
    r"(?:₹|rs\.?|inr|रु\.?|रुपये|रूपये)\s*([0-9][0-9,]*(?:\.\d{1,2})?)"
    r"|([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:/-|रुपये|रूपये|rupees)", re.I)
AMOUNT_HINT = re.compile(r"बकाया|देय|राशि|कुल|due|payable|outstanding|amount|total|जुर्माना|fine",
                         re.I)
DEADLINE_HINT = re.compile(r"तक|पूर्व|अंतिम\s*तिथि|अन्तिम\s*तिथि|by|before|last\s+date|due\s+date|"
                           r"within|on\s+or\s+before|उपस्थित", re.I)
PENALTY_RE = re.compile(r"[^।.\n]*(?:अधिभार|ब्याज|जुर्माना|विधिक\s*कार्यवाही|कुर्की|surcharge|penalty|"
                        r"interest|legal\s+action|recovery|disconnect|विच्छेदन|ध्वस्त)[^।.\n]*[।.]?",
                        re.I)
REF_RE = re.compile(r"(?:पत्रांक|संदर्भ|सन्दर्भ|ref(?:erence)?\.?|notice\s+no\.?|bill\s+no\.?|"
                    r"चालान\s*सं(?:ख्या)?\.?|challan\s+no\.?)\s*[:\-]?\s*([A-Za-z0-9/\-]{3,30})",
                    re.I)
PERIOD_RE = re.compile(r"(?:वित्तीय\s*वर्ष|financial\s+year|f\.?y\.?)\s*[:\-]?\s*(\d{4})\s*[–\-/]\s*"
                       r"(\d{2,4})", re.I)
DATE_PATTERNS = [
    re.compile(r"(?<!\d)(\d{1,2})[./\-](\d{1,2})[./\-](\d{4}|\d{2})(?!\d)"),
    re.compile(r"(?<!\d)(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})", re.I),
    re.compile(r"([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})", re.I),
    re.compile(r"(?<!\d)(\d{1,2})\s+(" + "|".join(HI_MONTHS) + r"),?\s+(\d{4})"),
]


def _to_date(d: int, m: int, y: int) -> date | None:
    if y < 100:
        y += 2000
    try:
        return date(y, m, d)
    except ValueError:
        return None


def find_dates(text: str) -> list[tuple[date, int]]:
    """All dates with their character offsets."""
    out: list[tuple[date, int]] = []
    for i, pat in enumerate(DATE_PATTERNS):
        for m in pat.finditer(text):
            g = m.groups()
            if i == 0:
                dt = _to_date(int(g[0]), int(g[1]), int(g[2]))
            elif i == 1:
                mon = EN_MONTHS.get(g[1][:3].lower())
                dt = _to_date(int(g[0]), mon, int(g[2])) if mon else None
            elif i == 2:
                mon = EN_MONTHS.get(g[0][:3].lower())
                dt = _to_date(int(g[1]), mon, int(g[2])) if mon else None
            else:
                dt = _to_date(int(g[0]), HI_MONTHS[g[1]], int(g[2]))
            if dt:
                out.append((dt, m.start()))
    return out


def _parse_amount(s: str) -> float | None:
    try:
        v = float(s.replace(",", ""))
    except ValueError:
        return None
    return v if 0 < v < 1e9 else None


def rules_extract(raw: str, today: date | None = None) -> NoticeFields:
    text = to_ascii_digits(raw)
    low = text.lower()
    today = today or date.today()
    f = NoticeFields()

    for pat, name in AUTHORITIES:
        if re.search(pat, text, re.I):
            f.authority = Field_(value=name, confidence=0.9 if name != "Municipal Corporation"
                                 else 0.6)
            break

    scores = {t: len(re.findall(p, low, re.I)) for t, p in NOTICE_TYPES}
    best = max(scores, key=scores.get)
    if scores[best]:
        conf = 0.9 if scores[best] >= 2 else 0.7
        # Property + water tax together is a combined municipal demand notice.
        f.notice_type = Field_(value=best, confidence=conf)
    else:
        f.notice_type = Field_(value="general", confidence=0.3)

    amounts = []
    for m in AMOUNT_RE.finditer(text):
        v = _parse_amount(m.group(1) or m.group(2))
        if v is not None:
            window = text[max(0, m.start() - 60):m.end() + 20]
            amounts.append((v, bool(AMOUNT_HINT.search(window))))
    if amounts:
        hinted = [a for a, h in amounts if h]
        # Prefer the largest amount near a "due/total" keyword: totals follow line items.
        value = max(hinted) if hinted else max(a for a, _ in amounts)
        conf = 0.9 if hinted else 0.6
        if len({a for a, _ in amounts}) > 3:
            conf -= 0.15
        f.amount = Field_(value=value, confidence=round(conf, 2))

    dates = find_dates(text)
    if dates:
        scored = []
        for dt, pos in dates:
            window = text[max(0, pos - 50):pos + 40]
            s = (2 if DEADLINE_HINT.search(window) else 0) + (1 if dt >= today else 0)
            scored.append((s, dt))
        scored.sort(key=lambda x: (x[0], x[1]))
        s, dt = scored[-1]
        f.deadline = Field_(value=dt.isoformat(), confidence=0.9 if s >= 2 else 0.55)

    pen = PENALTY_RE.search(text)
    if pen:
        f.penalty = Field_(value=pen.group(0).strip()[:300], confidence=0.75)

    ref = REF_RE.search(text)
    if ref:
        f.reference = Field_(value=ref.group(1), confidence=0.7)

    per = PERIOD_RE.search(text)
    if per:
        end = per.group(2)
        end = end[-2:] if len(end) == 4 else end
        f.period = Field_(value=f"{per.group(1)}-{end}", confidence=0.85)
    return f


EXTRACT_PROMPT = """You extract fields from Indian government notices. The text may be Hindi,
English or both, and OCR may have errors. Personal identifiers are masked like [AADHAAR].
Return ONLY a JSON object with these keys:
  notice_type: one of property_tax, water_bill, electricity_bill, encroachment,
               building_violation, traffic_challan, court_summons, general
  authority: issuing office in English, e.g. "Lucknow Nagar Nigam"
  amount: total amount payable as a number in rupees, or null
  deadline: last date to act as YYYY-MM-DD, or null if no date is written
  penalty: one short English sentence on the consequence of missing it, or null
  reference: notice / bill / challan number, or null
  period: financial year like "2026-27", or null
Never guess a value that is not in the text; use null instead."""


async def llm_extract(gateway: LLMGateway, masked_text: str) -> tuple[dict, str] | None:
    try:
        return await gateway.chat_json([
            {"role": "system", "content": EXTRACT_PROMPT},
            {"role": "user", "content": masked_text[:6000]},
        ])
    except LLMUnavailable:
        return None


VALID_TYPES = {t for t, _ in NOTICE_TYPES} | {"general"}


def merge(rules: NoticeFields, llm: dict | None) -> NoticeFields:
    """Combine both paths. Agreement boosts confidence, disagreement lowers it."""
    if not llm:
        return rules
    out = rules.model_copy(deep=True)

    def combine(name: str, llm_val, same) -> None:
        cur: Field_ = getattr(out, name)
        if llm_val in (None, "", "null"):
            return
        if cur.value is None:
            setattr(out, name, Field_(value=llm_val, confidence=0.6))
        elif same(cur.value, llm_val):
            setattr(out, name, Field_(value=cur.value, confidence=min(0.98, cur.confidence + 0.1)))
        else:
            # Keep the rules value (it is grounded in a regex match) but flag uncertainty.
            setattr(out, name, Field_(value=cur.value, confidence=min(cur.confidence, 0.5)))

    def num_eq(a, b):
        try:
            return abs(float(a) - float(b)) < 1
        except (TypeError, ValueError):
            return False

    t = llm.get("notice_type")
    if t in VALID_TYPES:
        if out.notice_type.value == "general" and t != "general":
            out.notice_type = Field_(value=t, confidence=0.65)
        else:
            combine("notice_type", t, lambda a, b: a == b)
    combine("amount", llm.get("amount"), num_eq)
    d = llm.get("deadline")
    if isinstance(d, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        combine("deadline", d, lambda a, b: a == b)
    if llm.get("authority"):
        combine("authority", str(llm["authority"]),
                lambda a, b: a.split()[0].lower() in b.lower() or b.split()[0].lower() in a.lower())
    for name in ("penalty", "reference", "period"):
        v = llm.get(name)
        if v and getattr(out, name).value is None:
            setattr(out, name, Field_(value=str(v)[:300], confidence=0.6))
    return out
