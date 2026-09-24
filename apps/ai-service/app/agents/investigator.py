"""Investigator agent: severity 1-5 and quality flags."""

import re

BASE = {"waste": 2, "water_drainage": 3, "roads": 2, "streetlights": 2, "public_infra": 2}
DANGER = re.compile(
    r"accident|injur|electrocut|current|करंट|shock|open manhole|खुला मैनहोल|मैनहोल खुला|"
    r"collapse|गिर गया|गिर गई|गिरने|flood|बाढ़|जलभराव|sewage.*(?:house|ghar)|"
    r"घर में (?:पानी|गंदा)|fire|आग|dead|मौत|बच्च|child|school|स्कूल|hospital|अस्पताल|"
    r"dengue|डेंगू|malaria", re.I)
DURATION = re.compile(r"(\d+)\s*(?:din|दिन|days?|hafte|हफ्ते|weeks?|mahine|महीने|months?)", re.I)
URGENT = re.compile(r"urgent|turant|तुरंत|jaldi|जल्दी|emergency|खतरा|khatra|danger", re.I)


def assess(text: str, category: str, has_photo: bool) -> tuple[int, list[str]]:
    sev = BASE.get(category, 2)
    flags: list[str] = []
    if DANGER.search(text):
        sev += 2
        flags.append("safety_risk")
    if URGENT.search(text):
        sev += 1
    m = DURATION.search(text)
    if m and ("week" in m.group(0) or "month" in m.group(0) or "महीने" in m.group(0)
              or "हफ्ते" in m.group(0) or int(m.group(1)) >= 7):
        sev += 1
        flags.append("long_pending")
    sev = max(1, min(5, sev))
    # Anti-spam: severity above medium needs photo evidence.
    if sev > 3 and not has_photo:
        sev = 3
        flags.append("photo_needed_for_high_severity")
    if len(text.strip()) < 12:
        flags.append("vague")
    return sev, flags
