"""Turn extracted fields into a plain-language explanation with next steps.

The template path is deterministic and always available. When a model is reachable it rewrites
the explanation in simpler words, but it is only given the extracted fields and the retrieved
guide, and its output must fit the Explanation schema.
"""

from datetime import date

from pydantic import ValidationError

from ..llm.base import LLMUnavailable
from ..llm.gateway import LLMGateway
from ..schemas import Explanation, Lang, NoticeFields

TYPE_TEXT = {
    "property_tax": ("A property (house) tax bill", "गृहकर (हाउस टैक्स) का बिल"),
    "water_bill": ("A water tax / water charges bill", "जलकर / पानी का बिल"),
    "electricity_bill": ("An electricity bill", "बिजली का बिल"),
    "encroachment": ("A notice to remove an encroachment", "अतिक्रमण हटाने का नोटिस"),
    "building_violation": ("A notice about construction that doesn't match the approved map",
                           "स्वीकृत नक्शे के बिना निर्माण का नोटिस"),
    "traffic_challan": ("A traffic fine (challan)", "ट्रैफ़िक चालान (जुर्माना)"),
    "court_summons": ("A summons asking you to appear", "हाज़िर होने का समन"),
    "general": ("A government notice", "एक सरकारी सूचना"),
}

MISS_TEXT = {
    "property_tax": ("A late surcharge is added and legal recovery can start.",
                     "देर होने पर अधिभार (जुर्माना) जुड़ेगा और वसूली की कानूनी कार्यवाही हो सकती है।"),
    "water_bill": ("A late surcharge is added and the connection can be cut.",
                   "देर होने पर अधिभार जुड़ेगा और कनेक्शन काटा जा सकता है।"),
    "electricity_bill": ("A late payment surcharge is added and supply can be disconnected.",
                         "देर होने पर अधिभार जुड़ेगा और बिजली काटी जा सकती है।"),
    "encroachment": ("The authority can remove it and charge you the cost.",
                     "विभाग खुद अतिक्रमण हटा सकता है और खर्च आपसे वसूल सकता है।"),
    "building_violation": ("Sealing or demolition proceedings can start.",
                           "सीलिंग या ध्वस्तीकरण की कार्यवाही शुरू हो सकती है।"),
    "traffic_challan": ("The case can go to court and the fine can increase.",
                        "मामला कोर्ट जा सकता है और जुर्माना बढ़ सकता है।"),
    "court_summons": ("The court can decide without hearing you.",
                      "कोर्ट आपकी बात सुने बिना फ़ैसला कर सकता है।"),
    "general": ("Check the notice for what happens if you don't respond.",
                "जवाब न देने पर क्या होगा, यह नोटिस में देखें।"),
}

STEPS = {
    "property_tax": (["Pay online on the Lucknow Nagar Nigam portal, or at your zonal office.",
                      "Keep the receipt. If the amount looks wrong, file an objection at the "
                      "zonal office before the due date."],
                     ["नगर निगम लखनऊ के पोर्टल पर ऑनलाइन या अपने ज़ोनल कार्यालय में जमा करें।",
                      "रसीद संभालकर रखें। राशि गलत लगे तो अंतिम तिथि से पहले ज़ोनल कार्यालय में "
                      "आपत्ति दें।"]),
    "water_bill": (["Pay at the Jal Kal office or through the Nagar Nigam portal.",
                    "Keep the receipt with your connection number."],
                   ["जलकल कार्यालय या नगर निगम पोर्टल से भुगतान करें।",
                    "कनेक्शन नंबर के साथ रसीद संभालकर रखें।"]),
    "electricity_bill": (["Pay on the UPPCL website or app, or at the sub-division office.",
                          "If the reading is wrong, raise a complaint on 1912 before paying."],
                         ["UPPCL वेबसाइट/ऐप या उपखंड कार्यालय में भुगतान करें।",
                          "रीडिंग गलत हो तो भुगतान से पहले 1912 पर शिकायत करें।"]),
    "traffic_challan": (["Pay on the e-Challan portal (echallan.parivahan.gov.in).",
                         "If you think it is wrong, you can contest it at the virtual court."],
                        ["ई-चालान पोर्टल (echallan.parivahan.gov.in) पर भुगतान करें।",
                         "चालान गलत लगे तो वर्चुअल कोर्ट में चुनौती दे सकते हैं।"]),
}
DEFAULT_STEPS = (["Visit the office named on the notice before the deadline with this notice and "
                  "an ID proof.", "Ask for a written receipt for anything you submit."],
                 ["अंतिम तिथि से पहले नोटिस और पहचान पत्र लेकर संबंधित कार्यालय जाएँ।",
                  "जो भी जमा करें उसकी लिखित रसीद ज़रूर लें।"])

AUTHORITY_HI = {
    "Lucknow Nagar Nigam": "नगर निगम लखनऊ",
    "Jal Kal Vibhag, Lucknow": "जलकल विभाग, लखनऊ",
    "Lucknow Development Authority": "लखनऊ विकास प्राधिकरण",
    "Madhyanchal Vidyut Vitran Nigam (UPPCL)": "मध्यांचल विद्युत वितरण निगम (UPPCL)",
    "Traffic Police, Uttar Pradesh": "यातायात पुलिस, उत्तर प्रदेश",
    "Tehsil office": "तहसील कार्यालय",
    "Court": "न्यायालय",
    "Municipal Corporation": "नगर निगम",
}

HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर",
             "अक्टूबर", "नवंबर", "दिसंबर"]

DISCLAIMER = {
    "en": "This is guidance, not legal advice. Always check the original notice and the "
          "official source.",
    "hi": "यह केवल मार्गदर्शन है, कानूनी सलाह नहीं। मूल नोटिस और आधिकारिक स्रोत ज़रूर देखें।",
}


def fmt_date(iso: str, lang: Lang) -> str:
    d = date.fromisoformat(iso)
    if lang == "hi":
        return f"{d.day} {HI_MONTHS[d.month - 1]} {d.year}"
    return d.strftime("%-d %B %Y")


def fmt_inr(v: float) -> str:
    """Indian digit grouping: 1,23,456."""
    whole = int(round(v))
    s = str(whole)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return f"₹{s}"


def template_explain(f: NoticeFields, lang: Lang) -> Explanation:
    i = 1 if lang == "hi" else 0
    t = f.notice_type.value or "general"
    what = TYPE_TEXT.get(t, TYPE_TEXT["general"])[i]
    if f.authority.value:
        auth = str(f.authority.value)
        what += f" — {auth}" if lang == "en" else f" — {AUTHORITY_HI.get(auth, auth)} से"
    owe = None
    if f.amount.value is not None:
        amt = fmt_inr(float(f.amount.value))
        period = f" for {f.period.value}" if f.period.value and lang == "en" else ""
        period_hi = f" (वित्तीय वर्ष {f.period.value})" if f.period.value and lang == "hi" else ""
        owe = f"You owe {amt}{period}" if lang == "en" else f"आपको {amt}{period_hi} जमा करने हैं"
    deadline = None
    if f.deadline.value:
        d = fmt_date(str(f.deadline.value), lang)
        deadline = f"Pay or respond by {d}" if lang == "en" else f"{d} तक जमा करें / जवाब दें"
    else:
        deadline = ("No date is written on the notice. Ask the office for the last date."
                    if lang == "en" else "नोटिस में तारीख नहीं लिखी है। कार्यालय से अंतिम तिथि पूछें।")
    steps = STEPS.get(t, DEFAULT_STEPS)[i]
    return Explanation(what_it_is=what, what_you_owe=owe, deadline=deadline,
                       if_you_miss_it=MISS_TEXT.get(t, MISS_TEXT["general"])[i],
                       do_this_now=list(steps))


EXPLAIN_PROMPT = """You explain Indian government notices to ordinary citizens in very simple
{lang_name} (short sentences, no legal jargon, class-5 reading level).
You get extracted fields and an official service guide. Use ONLY those facts. Do not invent
amounts, dates, offices or websites. Return ONLY JSON with keys:
what_it_is (one sentence), what_you_owe (sentence or null), deadline (sentence or null),
if_you_miss_it (one sentence), do_this_now (list of 2-4 short steps)."""


async def llm_explain(gateway: LLMGateway, f: NoticeFields, guide: str, lang: Lang,
                      base: Explanation) -> tuple[Explanation, str] | None:
    lang_name = "Hindi (Devanagari script)" if lang == "hi" else "English"
    facts = {k: v["value"] for k, v in f.model_dump().items() if v["value"] is not None}
    try:
        data, provider = await gateway.chat_json([
            {"role": "system", "content": EXPLAIN_PROMPT.format(lang_name=lang_name)},
            {"role": "user", "content": f"FIELDS: {facts}\n\nDRAFT: {base.model_dump_json()}\n\n"
                                        f"GUIDE:\n{guide[:2500]}"},
        ])
        exp = Explanation.model_validate(data)
    except (LLMUnavailable, ValidationError):
        return None
    # Keep the deterministic money/date sentences: those are the facts that matter most.
    exp.what_you_owe = base.what_you_owe
    exp.deadline = base.deadline
    return exp, provider
