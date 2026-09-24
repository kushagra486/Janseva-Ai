"""Deterministic scheme eligibility.

Eligibility is decided here, by rules loaded from data/schemes/*.json. The LLM is only ever
asked to phrase an explanation for a scheme that already passed these rules, so it cannot
invent eligibility.

Rule keys (all optional):
  age_min, age_max            inclusive, years
  genders                     list of "female" | "male" | "other"
  income_max                  annual household income in rupees
  occupations                 list of allowed occupations
  categories                  list of allowed social categories
  districts                   list of district names, or omit for all of Uttar Pradesh
  requires_widowed, requires_disability   true when the scheme needs that situation
"""

import json
from dataclasses import dataclass
from pathlib import Path

from ..schemas import SchemeAnswers

# Annual income bands: (lower inclusive, upper exclusive) in rupees.
INCOME_BANDS = {
    "below_50k": (0, 50_000),
    "50k_1l": (50_000, 100_000),
    "1l_2_5l": (100_000, 250_000),
    "2_5l_5l": (250_000, 500_000),
    "5l_8l": (500_000, 800_000),
    "above_8l": (800_000, float("inf")),
}

LABELS = {
    "en": {
        "age": "You are {age}, and the scheme is for ages {range}",
        "gender": "The scheme is for {genders} applicants",
        "income": "Your income band is within the ₹{max:,} limit",
        "income_check": "The limit is ₹{max:,} a year; your band crosses it, so an income "
                        "certificate will decide",
        "occupation": "It covers your occupation",
        "category": "It covers your category ({category})",
        "district": "It is available in {district}",
        "widowed": "It is for widowed women",
        "disability": "It is for persons with disability",
    },
    "hi": {
        "age": "आपकी उम्र {age} है, योजना {range} वर्ष के लिए है",
        "gender": "योजना {genders} आवेदकों के लिए है",
        "income": "आपकी आय ₹{max:,} की सीमा के भीतर है",
        "income_check": "आय सीमा ₹{max:,} वार्षिक है; आय प्रमाण पत्र से तय होगा",
        "occupation": "यह आपके व्यवसाय पर लागू है",
        "category": "यह आपकी श्रेणी ({category}) पर लागू है",
        "district": "यह {district} में उपलब्ध है",
        "widowed": "यह विधवा महिलाओं के लिए है",
        "disability": "यह दिव्यांगजन के लिए है",
    },
}
GENDER_HI = {"female": "महिला", "male": "पुरुष", "other": "अन्य"}


@dataclass
class RuleResult:
    scheme: dict
    status: str  # "eligible" | "needs_check"
    reasons: list[str]
    checks: list[str]


def load_schemes(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for f in sorted(path.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        out.extend(data if isinstance(data, list) else [data])
    return out


def evaluate(scheme: dict, a: SchemeAnswers) -> RuleResult | None:
    """Returns None when any hard rule fails."""
    r = scheme.get("rules", {})
    L = LABELS[a.language]
    reasons: list[str] = []
    checks: list[str] = []

    lo, hi = r.get("age_min", 0), r.get("age_max", 200)
    if not lo <= a.age <= hi:
        return None
    if "age_min" in r or "age_max" in r:
        rng = f"{lo}+" if hi >= 200 else f"{lo}–{hi}"
        reasons.append(L["age"].format(age=a.age, range=rng))

    if "genders" in r:
        if a.gender not in r["genders"]:
            return None
        g = r["genders"]
        names = ", ".join(GENDER_HI[x] for x in g) if a.language == "hi" else ", ".join(g)
        reasons.append(L["gender"].format(genders=names))

    if r.get("requires_widowed"):
        if not a.widowed:
            return None
        reasons.append(L["widowed"])
    if r.get("requires_disability"):
        if not a.disability:
            return None
        reasons.append(L["disability"])

    if "income_max" in r:
        band_lo, band_hi = INCOME_BANDS[a.income_band]
        cap = r["income_max"]
        if band_lo >= cap:
            return None
        if band_hi <= cap:
            reasons.append(L["income"].format(max=cap))
        else:
            checks.append(L["income_check"].format(max=cap))

    if "occupations" in r:
        if a.occupation not in r["occupations"]:
            return None
        reasons.append(L["occupation"])

    if "categories" in r:
        if a.category not in r["categories"]:
            return None
        reasons.append(L["category"].format(category=a.category.upper()))

    if "districts" in r:
        if a.district.strip().lower() not in {d.lower() for d in r["districts"]}:
            return None
        reasons.append(L["district"].format(district=a.district))

    checks.extend(scheme.get("extra_checks_" + a.language, scheme.get("extra_checks", [])))
    return RuleResult(scheme, "needs_check" if checks else "eligible", reasons, checks)


def match(schemes: list[dict], a: SchemeAnswers) -> list[RuleResult]:
    results = [res for s in schemes if (res := evaluate(s, a))]
    # Definite matches first, then by how many rules the person positively satisfied
    # (a more targeted scheme is usually more relevant).
    results.sort(key=lambda x: (x.status != "eligible", -len(x.reasons)))
    return results
