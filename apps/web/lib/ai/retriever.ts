// Keyword retrieval over the bundled corpus (apps/web/lib/ai/data/corpus.json, generated from
// data/services/*.md). The original ai-service also scored a hash-based embedding similarity
// (0.4 weight) alongside keyword overlap (0.6 weight); that embedding was a dependency-free
// hash heuristic, not a real model, so dropping it for pure keyword scoring here is a small
// quality simplification, not a loss of a real semantic signal.
import corpus from "./data/corpus.json";

export type Chunk = { id: string; sourceId: string; title: string; url: string | null; tags: string[]; ordinal: number; content: string };

const SYNONYMS: Record<string, string> = {
  janm: "birth", "जन्म": "birth", praman: "certificate", "प्रमाण": "certificate",
  "पत्र": "certificate", patra: "certificate", mrityu: "death", "मृत्यु": "death",
  pani: "water", "पानी": "water", jal: "water", "जल": "water", connection: "connection",
  "कनेक्शन": "connection", bijli: "electricity", "बिजली": "electricity",
  ghar: "house", "घर": "house", grihkar: "property", "गृहकर": "property", tax: "tax",
  "कर": "tax", pension: "pension", "पेंशन": "pension", aay: "income", "आय": "income",
  jati: "caste", "जाति": "caste", niwas: "domicile", "निवास": "domicile",
  ration: "ration", "राशन": "ration", card: "card", "कार्ड": "card",
  pay: "pay", bhugtan: "pay", "भुगतान": "pay", jama: "pay", "जमा": "pay",
  online: "online", "ऑनलाइन": "online", shikayat: "complaint", "शिकायत": "complaint",
  vivah: "marriage", "विवाह": "marriage", shaadi: "marriage", "शादी": "marriage",
  licence: "license", dukan: "shop", "दुकान": "shop", naksha: "map", "नक्शा": "map",
  pata: "address", "पता": "address", badlav: "change", "बदलाव": "change",
  kaise: "how", "कैसे": "how", kahan: "where", "कहाँ": "where", kitna: "fee",
  fees: "fee", "शुल्क": "fee", shulk: "fee", dastavez: "documents",
  "दस्तावेज": "documents", kagaz: "documents",
};
const STOP = new Set(["how", "do", "i", "the", "a", "an", "to", "of", "for", "in", "is", "my", "me", "get",
  "kaise", "karein", "kare", "karen", "ka", "ki", "ke", "hai", "mein", "se", "what",
  "कैसे", "करें", "का", "की", "के", "है", "में", "से", "और", "को", "where", "can"]);

function normalize(text: string): string {
  return (text.match(/[\wऀ-ॿ]+/gu) ?? []).join(" ").toLowerCase();
}

function keywords(text: string): string[] {
  const out: string[] = [];
  for (const w of normalize(text).split(" ")) {
    const mapped = SYNONYMS[w] ?? w;
    if (mapped && !STOP.has(mapped) && mapped.length > 1) out.push(mapped);
  }
  return out;
}

const chunks = corpus as Chunk[];
const termsByChunk: Map<string, string[]> = new Map();
const df = new Map<string, number>();
for (const c of chunks) {
  const terms = keywords(`${c.content} ${c.tags.join(" ")}`);
  termsByChunk.set(c.id, terms);
  for (const t of new Set(terms)) df.set(t, (df.get(t) ?? 0) + 1);
}

export type Hit = { chunk: Chunk; score: number };

export function search(query: string, k = 6): Hit[] {
  if (!chunks.length) return [];
  const qTerms = new Set(keywords(query));
  if (!qTerms.size) return [];
  const n = Math.max(chunks.length, 1);
  const scored: Hit[] = chunks.map((c) => {
    const terms = termsByChunk.get(c.id) ?? [];
    const counts = new Map<string, number>();
    for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of qTerms) {
      const tf = counts.get(t) ?? 0;
      if (tf > 0) score += Math.log(1 + n / (1 + (df.get(t) ?? 0))) * (1 + Math.log(tf));
    }
    return { chunk: c, score };
  });
  const maxScore = Math.max(...scored.map((s) => s.score), 1e-9);
  return scored
    .map((s) => ({ chunk: s.chunk, score: s.score / maxScore }))
    .filter((s) => s.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Collapse hits to one per source and keep the best-scoring ones, for clean citations. */
export function rerank(hits: Hit[], maxSources = 2, minRatio = 0.5): Hit[] {
  if (!hits.length) return [];
  const best = new Map<string, Hit>();
  for (const h of hits) {
    const prev = best.get(h.chunk.sourceId);
    if (!prev || h.score > prev.score) best.set(h.chunk.sourceId, h);
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  const top = ranked[0].score;
  return ranked.slice(0, maxSources).filter((h) => h.score >= top * minRatio);
}
