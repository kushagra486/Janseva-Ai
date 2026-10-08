import { NextResponse, type NextRequest } from "next/server";
import { SchemeAnswers, type SchemeMatch, type SchemeMatchResponse } from "@janseva/shared";
import { chatJson, LLMUnavailable } from "@/lib/ai/groq";
import { allSchemes, matchSchemes, translated } from "@/lib/ai/schemes";

const EXPLAIN = `In 1-2 very simple sentences of {lang}, tell a citizen why this government scheme
fits them and what they get. Use ONLY the given facts. Return ONLY JSON: {"text": "..."}`;

export async function POST(req: NextRequest) {
  const a = SchemeAnswers.parse(await req.json());
  const results = matchSchemes(a);
  let provider = "rules";
  const out: SchemeMatch[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const s = r.scheme;
    const benefit = String(translated(s, "benefit", a.language));
    let explanation = r.reasons.slice(0, 2).join(" ") + (r.reasons.length ? "." : "");
    if (i < 3) {
      const lang = a.language === "hi" ? "Hindi (Devanagari)" : "English";
      try {
        const data = await chatJson([
          { role: "system", content: EXPLAIN.replace("{lang}", lang) },
          { role: "user", content: `Scheme: ${translated(s, "name", a.language)}. Benefit: ${benefit}. Why eligible: ${JSON.stringify(r.reasons)}. Still to check: ${JSON.stringify(r.checks)}` },
        ]);
        if (typeof data.text === "string" && data.text.trim()) {
          explanation = data.text.trim();
          provider = "groq";
        }
      } catch (e) {
        if (!(e instanceof LLMUnavailable)) throw e;
      }
    }
    const docs = translated(s, "documents", a.language);
    out.push({
      id: s.id, name: String(translated(s, "name", a.language)), status: r.status,
      reasons: r.reasons, checks: r.checks, benefit, documents: Array.isArray(docs) ? docs.map(String) : [],
      apply_url: s.apply_url ?? null, source_url: s.source_url ?? null, explanation,
    });
  }
  return NextResponse.json({ matches: out, evaluated: allSchemes().length, provider } satisfies SchemeMatchResponse);
}
