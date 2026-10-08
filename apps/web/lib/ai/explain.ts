// Turn extracted fields into a plain-language explanation. Ported from pipelines/explain.py.
import type { Explanation, Lang, NoticeFields } from "@janseva/shared";
import { chatJson, LLMUnavailable } from "./groq";

const TYPE_TEXT: Record<string, [string, string]> = {
  property_tax: ["A property (house) tax bill", "गृहकर (हाउस टैक्स) का बिल"],
  water_bill: ["A water tax / water charges bill", "जलकर / पानी का बिल"],
  electricity_bill: ["An electricity bill", "बिजली का बिल"],
  encroachment: ["A notice to remove an encroachment", "अतिक्रमण हटाने का नोटिस"],
  building_violation: ["A notice about construction that doesn't match the approved map", "स्वीकृत नक्शे के बिना निर्माण का नोटिस"],
  traffic_challan: ["A traffic fine (challan)", "ट्रैफ़िक चालान (जुर्माना)"],
  court_summons: ["A summons asking you to appear", "हाज़िर होने का समन"],
  general: ["A government notice", "एक सरकारी सूचना"],
};
const MISS_TEXT: Record<string, [string, string]> = {
  property_tax: ["A late surcharge is added and legal recovery can start.", "देर होने पर अधिभार (जुर्माना) जुड़ेगा और वसूली की कानूनी कार्यवाही हो सकती है।"],
  water_bill: ["A late surcharge is added and the connection can be cut.", "देर होने पर अधिभार जुड़ेगा और कनेक्शन काटा जा सकता है।"],
  electricity_bill: ["A late payment surcharge is added and supply can be disconnected.", "देर होने पर अधिभार जुड़ेगा और बिजली काटी जा सकती है।"],
  encroachment: ["The authority can remove it and charge you the cost.", "विभाग खुद अतिक्रमण हटा सकता है और खर्च आपसे वसूल सकता है।"],
  building_violation: ["Sealing or demolition proceedings can start.", "सीलिंग या ध्वस्तीकरण की कार्यवाही शुरू हो सकती है।"],
  traffic_challan: ["The case can go to court and the fine can increase.", "मामला कोर्ट जा सकता है और जुर्माना बढ़ सकता है।"],
  court_summons: ["The court can decide without hearing you.", "कोर्ट आपकी बात सुने बिना फ़ैसला कर सकता है।"],
  general: ["Check the notice for what happens if you don't respond.", "जवाब न देने पर क्या होगा, यह नोटिस में देखें।"],
};
const STEPS: Record<string, [string[], string[]]> = {
  property_tax: [
    ["Pay online on the Lucknow Nagar Nigam portal, or at your zonal office.", "Keep the receipt. If the amount looks wrong, file an objection at the zonal office before the due date."],
    ["नगर निगम लखनऊ के पोर्टल पर ऑनलाइन या अपने ज़ोनल कार्यालय में जमा करें।", "रसीद संभालकर रखें। राशि गलत लगे तो अंतिम तिथि से पहले ज़ोनल कार्यालय में आपत्ति दें।"],
  ],
  water_bill: [
    ["Pay at the Jal Kal office or through the Nagar Nigam portal.", "Keep the receipt with your connection number."],
    ["जलकल कार्यालय या नगर निगम पोर्टल से भुगतान करें।", "कनेक्शन नंबर के साथ रसीद संभालकर रखें।"],
  ],
  electricity_bill: [
    ["Pay on the UPPCL website or app, or at the sub-division office.", "If the reading is wrong, raise a complaint on 1912 before paying."],
    ["UPPCL वेबसाइट/ऐप या उपखंड कार्यालय में भुगतान करें।", "रीडिंग गलत हो तो भुगतान से पहले 1912 पर शिकायत करें।"],
  ],
  traffic_challan: [
    ["Pay on the e-Challan portal (echallan.parivahan.gov.in).", "If you think it is wrong, you can contest it at the virtual court."],
    ["ई-चालान पोर्टल (echallan.parivahan.gov.in) पर भुगतान करें।", "चालान गलत लगे तो वर्चुअल कोर्ट में चुनौती दे सकते हैं।"],
  ],
};
const DEFAULT_STEPS: [string[], string[]] = [
  ["Visit the office named on the notice before the deadline with this notice and an ID proof.", "Ask for a written receipt for anything you submit."],
  ["अंतिम तिथि से पहले नोटिस और पहचान पत्र लेकर संबंधित कार्यालय जाएँ।", "जो भी जमा करें उसकी लिखित रसीद ज़रूर लें।"],
];
const AUTHORITY_HI: Record<string, string> = {
  "Lucknow Nagar Nigam": "नगर निगम लखनऊ",
  "Jal Kal Vibhag, Lucknow": "जलकल विभाग, लखनऊ",
  "Lucknow Development Authority": "लखनऊ विकास प्राधिकरण",
  "Madhyanchal Vidyut Vitran Nigam (UPPCL)": "मध्यांचल विद्युत वितरण निगम (UPPCL)",
  "Traffic Police, Uttar Pradesh": "यातायात पुलिस, उत्तर प्रदेश",
  "Tehsil office": "तहसील कार्यालय",
  Court: "न्यायालय",
  "Municipal Corporation": "नगर निगम",
};
const HI_MONTH_NAMES = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const EN_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const DISCLAIMER: Record<Lang, string> = {
  en: "This is guidance, not legal advice. Always check the original notice and the official source.",
  hi: "यह केवल मार्गदर्शन है, कानूनी सलाह नहीं। मूल नोटिस और आधिकारिक स्रोत ज़रूर देखें।",
};

function fmtDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split("-").map(Number);
  return lang === "hi" ? `${d} ${HI_MONTH_NAMES[m - 1]} ${y}` : `${d} ${EN_MONTH_NAMES[m - 1]} ${y}`;
}

function fmtInr(v: number): string {
  const whole = Math.round(v);
  let s = String(whole);
  if (s.length > 3) {
    let head = s.slice(0, -3);
    const tail = s.slice(-3);
    const parts: string[] = [];
    while (head.length > 2) {
      parts.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    if (head) parts.unshift(head);
    s = [...parts, tail].join(",");
  }
  return `₹${s}`;
}

export function templateExplain(f: NoticeFields, lang: Lang): Explanation {
  const i = lang === "hi" ? 1 : 0;
  const t = (f.notice_type.value as string) || "general";
  let what = (TYPE_TEXT[t] ?? TYPE_TEXT.general)[i];
  if (f.authority.value) {
    const auth = String(f.authority.value);
    what += lang === "en" ? ` — ${auth}` : ` — ${AUTHORITY_HI[auth] ?? auth} से`;
  }
  let owe: string | null = null;
  if (f.amount.value !== null) {
    const amt = fmtInr(Number(f.amount.value));
    const period = f.period.value && lang === "en" ? ` for ${f.period.value}` : "";
    const periodHi = f.period.value && lang === "hi" ? ` (वित्तीय वर्ष ${f.period.value})` : "";
    owe = lang === "en" ? `You owe ${amt}${period}` : `आपको ${amt}${periodHi} जमा करने हैं`;
  }
  let deadline: string;
  if (f.deadline.value) {
    const d = fmtDate(String(f.deadline.value), lang);
    deadline = lang === "en" ? `Pay or respond by ${d}` : `${d} तक जमा करें / जवाब दें`;
  } else {
    deadline = lang === "en"
      ? "No date is written on the notice. Ask the office for the last date."
      : "नोटिस में तारीख नहीं लिखी है। कार्यालय से अंतिम तिथि पूछें।";
  }
  const steps = (STEPS[t] ?? DEFAULT_STEPS)[i];
  return {
    what_it_is: what, what_you_owe: owe, deadline,
    if_you_miss_it: (MISS_TEXT[t] ?? MISS_TEXT.general)[i],
    do_this_now: [...steps],
  };
}

const EXPLAIN_PROMPT = `You explain Indian government notices to ordinary citizens in very simple
{lang_name} (short sentences, no legal jargon, class-5 reading level).
You get extracted fields and an official service guide. Use ONLY those facts. Do not invent
amounts, dates, offices or websites. Return ONLY JSON with keys:
what_it_is (one sentence), what_you_owe (sentence or null), deadline (sentence or null),
if_you_miss_it (one sentence), do_this_now (list of 2-4 short steps).`;

export async function llmExplain(f: NoticeFields, guide: string, lang: Lang, base: Explanation): Promise<Explanation | null> {
  const langName = lang === "hi" ? "Hindi (Devanagari script)" : "English";
  const facts = Object.fromEntries(
    Object.entries(f).filter(([, v]) => (v as { value: unknown }).value !== null).map(([k, v]) => [k, (v as { value: unknown }).value]),
  );
  try {
    const data = await chatJson([
      { role: "system", content: EXPLAIN_PROMPT.replace("{lang_name}", langName) },
      { role: "user", content: `FIELDS: ${JSON.stringify(facts)}\n\nDRAFT: ${JSON.stringify(base)}\n\nGUIDE:\n${guide.slice(0, 2500)}` },
    ]);
    if (typeof data.what_it_is !== "string" || typeof data.if_you_miss_it !== "string" || !Array.isArray(data.do_this_now)) {
      return null;
    }
    return {
      what_it_is: data.what_it_is,
      what_you_owe: base.what_you_owe,
      deadline: base.deadline,
      if_you_miss_it: data.if_you_miss_it,
      do_this_now: data.do_this_now.map(String),
    };
  } catch (e) {
    if (e instanceof LLMUnavailable) return null;
    return null;
  }
}
