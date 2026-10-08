// Extract structured fields from notice text. Ported from apps/ai-service's pipelines/extract.py.
import type { NoticeFields } from "@janseva/shared";
import { chatJson, LLMUnavailable } from "./groq";
import { toAsciiDigits } from "./pii";

type Field = { value: string | number | null; confidence: number };
const empty = (): Field => ({ value: null, confidence: 0 });
function emptyFields(): NoticeFields {
  return {
    notice_type: empty(), authority: empty(), amount: empty(), deadline: empty(),
    penalty: empty(), reference: empty(), period: empty(),
  };
}

const HI_MONTHS: Record<string, number> = {
  "जनवरी": 1, "फरवरी": 2, "फ़रवरी": 2, "मार्च": 3, "अप्रैल": 4, "मई": 5, "जून": 6,
  "जुलाई": 7, "अगस्त": 8, "सितंबर": 9, "सितम्बर": 9, "अक्टूबर": 10, "अक्तूबर": 10,
  "नवंबर": 11, "नवम्बर": 11, "दिसंबर": 12, "दिसम्बर": 12,
};
const EN_MONTHS: Record<string, number> = Object.fromEntries(
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((m, i) => [m, i + 1]),
);

const AUTHORITIES: [RegExp, string][] = [
  [/जलकल\s*विभाग|jal\s*kal/i, "Jal Kal Vibhag, Lucknow"],
  [/लखनऊ\s*विकास\s*प्राधिकरण|lucknow\s+development\s+authority|\bLDA\b/i, "Lucknow Development Authority"],
  [/मध्यांचल\s*विद्युत|madhyanchal\s+vidyut|\bMVVNL\b|\bUPPCL\b|विद्युत\s*वितरण/i, "Madhyanchal Vidyut Vitran Nigam (UPPCL)"],
  [/यातायात\s*पुलिस|traffic\s+police|e-?challan/i, "Traffic Police, Uttar Pradesh"],
  [/तहसील|tehsil|तहसीलदार|tehsildar/i, "Tehsil office"],
  [/न्यायालय|court\s+of|district\s+court/i, "Court"],
  [/नगर\s*निगम\s*,?\s*लखनऊ|लखनऊ\s*नगर\s*निगम|lucknow\s+(?:nagar\s+nigam|municipal\s+corporation)|nagar\s+nigam,?\s+lucknow/i, "Lucknow Nagar Nigam"],
  [/नगर\s*निगम|municipal\s+corporation|nagar\s+nigam/i, "Municipal Corporation"],
];

const NOTICE_TYPES: [string, RegExp][] = [
  ["property_tax", /गृहकर|गृह\s*कर|भवन\s*कर|property\s+tax|house\s+tax/gi],
  ["water_bill", /जलकर|जल\s*कर|जल\s*मूल्य|water\s+(?:tax|bill|charges)|sewer/gi],
  ["electricity_bill", /विद्युत\s*बिल|बिजली|electricity|kwh|यूनिट|units\s+consumed/gi],
  ["encroachment", /अतिक्रमण|encroachment/gi],
  ["building_violation", /अवैध\s*निर्माण|मानचित्र|unauthori[sz]ed\s+construction|sanctioned\s+(?:map|plan)|demolition|ध्वस्तीकरण/gi],
  ["traffic_challan", /चालान|challan|motor\s+vehicles\s+act|मोटर\s*यान/gi],
  ["court_summons", /समन|summons|उपस्थित\s*हों|appear\s+before/gi],
];

const AMOUNT_RE = /(?:₹|rs\.?|inr|रु\.?|रुपये|रूपये)\s*([0-9][0-9,]*(?:\.\d{1,2})?)|([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:\/-|रुपये|रूपये|rupees)/gi;
const AMOUNT_HINT = /बकाया|देय|राशि|कुल|due|payable|outstanding|amount|total|जुर्माना|fine/i;
const DEADLINE_HINT = /तक|पूर्व|अंतिम\s*तिथि|अन्तिम\s*तिथि|by|before|last\s+date|due\s+date|within|on\s+or\s+before|उपस्थित/i;
const PENALTY_RE = /[^।.\n]*(?:अधिभार|ब्याज|जुर्माना|विधिक\s*कार्यवाही|कुर्की|surcharge|penalty|interest|legal\s+action|recovery|disconnect|विच्छेदन|ध्वस्त)[^।.\n]*[।.]?/i;
const REF_RE = /(?:पत्रांक|संदर्भ|सन्दर्भ|ref(?:erence)?\.?|notice\s+no\.?|bill\s+no\.?|चालान\s*सं(?:ख्या)?\.?|challan\s+no\.?)\s*[:\-]?\s*([A-Za-z0-9/\-]{3,30})/i;
const PERIOD_RE = /(?:वित्तीय\s*वर्ष|financial\s+year|f\.?y\.?)\s*[:\-]?\s*(\d{4})\s*[–\-/]\s*(\d{2,4})/i;

function toDate(d: number, m: number, y: number): Date | null {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : null;
}

function findDates(text: string): [Date, number][] {
  const out: [Date, number][] = [];
  const patterns: [RegExp, (g: RegExpMatchArray) => Date | null][] = [
    [/(?<!\d)(\d{1,2})[./\-](\d{1,2})[./\-](\d{4}|\d{2})(?!\d)/g, (g) => toDate(+g[1], +g[2], +g[3])],
    [/(?<!\d)(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/gi, (g) => {
      const mon = EN_MONTHS[g[2].slice(0, 3).toLowerCase()];
      return mon ? toDate(+g[1], mon, +g[3]) : null;
    }],
    [/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/gi, (g) => {
      const mon = EN_MONTHS[g[1].slice(0, 3).toLowerCase()];
      return mon ? toDate(+g[2], mon, +g[3]) : null;
    }],
    [new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${Object.keys(HI_MONTHS).join("|")}),?\\s+(\\d{4})`, "g"), (g) => toDate(+g[1], HI_MONTHS[g[2]], +g[3])],
  ];
  for (const [pat, parse] of patterns) {
    for (const m of text.matchAll(pat)) {
      const dt = parse(m);
      if (dt) out.push([dt, m.index ?? 0]);
    }
  }
  return out;
}

function parseAmount(s: string): number | null {
  const v = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(v) && v > 0 && v < 1e9 ? v : null;
}

export function rulesExtract(raw: string, today = new Date()): NoticeFields {
  const text = toAsciiDigits(raw);
  const low = text.toLowerCase();
  const f = emptyFields();

  for (const [pat, name] of AUTHORITIES) {
    if (pat.test(text)) {
      f.authority = { value: name, confidence: name !== "Municipal Corporation" ? 0.9 : 0.6 };
      break;
    }
  }

  const scores = NOTICE_TYPES.map(([t, p]) => [t, [...low.matchAll(p)].length] as const);
  const best = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (best[1] > 0) {
    f.notice_type = { value: best[0], confidence: best[1] >= 2 ? 0.9 : 0.7 };
  } else {
    f.notice_type = { value: "general", confidence: 0.3 };
  }

  const amounts: [number, boolean][] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const v = parseAmount(m[1] ?? m[2] ?? "");
    if (v !== null) {
      const start = m.index ?? 0;
      const window = text.slice(Math.max(0, start - 60), start + (m[0]?.length ?? 0) + 20);
      amounts.push([v, AMOUNT_HINT.test(window)]);
    }
  }
  if (amounts.length) {
    const hinted = amounts.filter(([, h]) => h).map(([v]) => v);
    const value = hinted.length ? Math.max(...hinted) : Math.max(...amounts.map(([v]) => v));
    let conf = hinted.length ? 0.9 : 0.6;
    if (new Set(amounts.map(([v]) => v)).size > 3) conf -= 0.15;
    f.amount = { value, confidence: Math.round(conf * 100) / 100 };
  }

  const dates = findDates(text);
  if (dates.length) {
    const scored = dates.map(([dt, pos]) => {
      const window = text.slice(Math.max(0, pos - 50), pos + 40);
      const s = (DEADLINE_HINT.test(window) ? 2 : 0) + (dt.getTime() >= today.getTime() ? 1 : 0);
      return [s, dt] as const;
    });
    scored.sort((a, b) => (a[0] - b[0]) || (a[1].getTime() - b[1].getTime()));
    const [s, dt] = scored[scored.length - 1];
    f.deadline = { value: dt.toISOString().slice(0, 10), confidence: s >= 2 ? 0.9 : 0.55 };
  }

  const pen = PENALTY_RE.exec(text);
  if (pen) f.penalty = { value: pen[0].trim().slice(0, 300), confidence: 0.75 };

  const ref = REF_RE.exec(text);
  if (ref) f.reference = { value: ref[1], confidence: 0.7 };

  const per = PERIOD_RE.exec(text);
  if (per) {
    const end = per[2].length === 4 ? per[2].slice(-2) : per[2];
    f.period = { value: `${per[1]}-${end}`, confidence: 0.85 };
  }
  return f;
}

const EXTRACT_PROMPT = `You extract fields from Indian government notices. The text may be Hindi,
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
Never guess a value that is not in the text; use null instead.`;

export async function llmExtract(maskedText: string): Promise<Record<string, unknown> | null> {
  try {
    return await chatJson([
      { role: "system", content: EXTRACT_PROMPT },
      { role: "user", content: maskedText.slice(0, 6000) },
    ]);
  } catch (e) {
    if (e instanceof LLMUnavailable) return null;
    throw e;
  }
}

const VALID_TYPES = new Set([...NOTICE_TYPES.map(([t]) => t), "general"]);

export function merge(rules: NoticeFields, llm: Record<string, unknown> | null): NoticeFields {
  if (!llm) return rules;
  const out: NoticeFields = structuredClone(rules);

  const combine = (name: keyof NoticeFields, llmVal: unknown, same: (a: unknown, b: unknown) => boolean) => {
    const cur = out[name];
    if (llmVal === null || llmVal === undefined || llmVal === "" || llmVal === "null") return;
    if (cur.value === null) {
      out[name] = { value: llmVal as string | number, confidence: 0.6 };
    } else if (same(cur.value, llmVal)) {
      out[name] = { value: cur.value, confidence: Math.min(0.98, cur.confidence + 0.1) };
    } else {
      out[name] = { value: cur.value, confidence: Math.min(cur.confidence, 0.5) };
    }
  };
  const numEq = (a: unknown, b: unknown) => {
    const x = Number(a), y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 1;
  };

  const t = llm.notice_type;
  if (typeof t === "string" && VALID_TYPES.has(t)) {
    if (out.notice_type.value === "general" && t !== "general") {
      out.notice_type = { value: t, confidence: 0.65 };
    } else {
      combine("notice_type", t, (a, b) => a === b);
    }
  }
  combine("amount", llm.amount, numEq);
  const d = llm.deadline;
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) combine("deadline", d, (a, b) => a === b);
  if (llm.authority) {
    combine("authority", String(llm.authority), (a, b) => {
      const as = String(a).toLowerCase(), bs = String(b).toLowerCase();
      return as.split(" ")[0] ? bs.includes(as.split(" ")[0]) || as.includes(bs.split(" ")[0]) : false;
    });
  }
  for (const name of ["penalty", "reference", "period"] as const) {
    const v = llm[name];
    if (v && out[name].value === null) out[name] = { value: String(v).slice(0, 300), confidence: 0.6 };
  }
  return out;
}
