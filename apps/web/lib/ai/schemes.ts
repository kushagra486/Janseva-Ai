// Deterministic scheme eligibility. Ported from pipelines/schemes.py. The LLM is only ever
// asked to phrase an explanation for a scheme that already passed these rules.
import type { SchemeAnswers } from "@janseva/shared";
import central from "./data/schemes/central.json";
import upState from "./data/schemes/up-state.json";

type Scheme = {
  id: string;
  name: string;
  name_hi?: string;
  level: string;
  department: string;
  benefit: string;
  benefit_hi?: string;
  rules: {
    age_min?: number; age_max?: number;
    genders?: string[];
    income_max?: number;
    occupations?: string[];
    categories?: string[];
    districts?: string[];
    requires_widowed?: boolean;
    requires_disability?: boolean;
  };
  extra_checks?: string[];
  extra_checks_hi?: string[];
  documents?: string[];
  documents_hi?: string[];
  apply_url?: string | null;
  source_url?: string | null;
};

const SCHEMES: Scheme[] = [...(central as Scheme[]), ...(upState as Scheme[])];

const INCOME_BANDS: Record<string, [number, number]> = {
  below_50k: [0, 50_000], "50k_1l": [50_000, 100_000], "1l_2_5l": [100_000, 250_000],
  "2_5l_5l": [250_000, 500_000], "5l_8l": [500_000, 800_000], above_8l: [800_000, Infinity],
};

const LABELS = {
  en: {
    age: (age: number, range: string) => `You are ${age}, and the scheme is for ages ${range}`,
    gender: (g: string) => `The scheme is for ${g} applicants`,
    income: (max: number) => `Your income band is within the ₹${max.toLocaleString("en-IN")} limit`,
    incomeCheck: (max: number) => `The limit is ₹${max.toLocaleString("en-IN")} a year; your band crosses it, so an income certificate will decide`,
    occupation: () => "It covers your occupation",
    category: (c: string) => `It covers your category (${c})`,
    district: (d: string) => `It is available in ${d}`,
    widowed: () => "It is for widowed women",
    disability: () => "It is for persons with disability",
  },
  hi: {
    age: (age: number, range: string) => `आपकी उम्र ${age} है, योजना ${range} वर्ष के लिए है`,
    gender: (g: string) => `योजना ${g} आवेदकों के लिए है`,
    income: (max: number) => `आपकी आय ₹${max.toLocaleString("en-IN")} की सीमा के भीतर है`,
    incomeCheck: (max: number) => `आय सीमा ₹${max.toLocaleString("en-IN")} वार्षिक है; आय प्रमाण पत्र से तय होगा`,
    occupation: () => "यह आपके व्यवसाय पर लागू है",
    category: (c: string) => `यह आपकी श्रेणी (${c}) पर लागू है`,
    district: (d: string) => `यह ${d} में उपलब्ध है`,
    widowed: () => "यह विधवा महिलाओं के लिए है",
    disability: () => "यह दिव्यांगजन के लिए है",
  },
};
const GENDER_HI: Record<string, string> = { female: "महिला", male: "पुरुष", other: "अन्य" };

export type RuleResult = { scheme: Scheme; status: "eligible" | "needs_check"; reasons: string[]; checks: string[] };

function evaluate(scheme: Scheme, a: SchemeAnswers): RuleResult | null {
  const r = scheme.rules;
  const L = LABELS[a.language];
  const reasons: string[] = [];
  const checks: string[] = [];

  const lo = r.age_min ?? 0, hi = r.age_max ?? 200;
  if (!(a.age >= lo && a.age <= hi)) return null;
  if (r.age_min !== undefined || r.age_max !== undefined) {
    reasons.push(L.age(a.age, hi >= 200 ? `${lo}+` : `${lo}–${hi}`));
  }

  if (r.genders) {
    if (!r.genders.includes(a.gender)) return null;
    const names = a.language === "hi" ? r.genders.map((g) => GENDER_HI[g]).join(", ") : r.genders.join(", ");
    reasons.push(L.gender(names));
  }
  if (r.requires_widowed) {
    if (!a.widowed) return null;
    reasons.push(L.widowed());
  }
  if (r.requires_disability) {
    if (!a.disability) return null;
    reasons.push(L.disability());
  }
  if (r.income_max !== undefined) {
    const [bandLo, bandHi] = INCOME_BANDS[a.income_band];
    const cap = r.income_max;
    if (bandLo >= cap) return null;
    if (bandHi <= cap) reasons.push(L.income(cap));
    else checks.push(L.incomeCheck(cap));
  }
  if (r.occupations) {
    if (!r.occupations.includes(a.occupation)) return null;
    reasons.push(L.occupation());
  }
  if (r.categories) {
    if (!r.categories.includes(a.category)) return null;
    reasons.push(L.category(a.category.toUpperCase()));
  }
  if (r.districts) {
    if (!r.districts.some((d) => d.toLowerCase() === a.district.trim().toLowerCase())) return null;
    reasons.push(L.district(a.district));
  }
  checks.push(...(a.language === "hi" ? scheme.extra_checks_hi ?? scheme.extra_checks ?? [] : scheme.extra_checks ?? []));
  return { scheme, status: checks.length ? "needs_check" : "eligible", reasons, checks };
}

export function allSchemes(): Scheme[] {
  return SCHEMES;
}

export function matchSchemes(a: SchemeAnswers): RuleResult[] {
  const results = SCHEMES.map((s) => evaluate(s, a)).filter((r): r is RuleResult => r !== null);
  results.sort((x, y) => Number(x.status !== "eligible") - Number(y.status !== "eligible") || y.reasons.length - x.reasons.length);
  return results;
}

export function translated(s: Scheme, key: "name" | "benefit" | "documents", lang: "hi" | "en") {
  const k = `${key}_hi` as keyof Scheme;
  return (lang === "hi" ? s[k] : undefined) ?? s[key as keyof Scheme];
}
