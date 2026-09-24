"""Hybrid retriever over the curated corpus: vector similarity plus keyword overlap.

The in-memory index is loaded from data/services/*.md at startup and extended by
/v1/admin/ingest. When Supabase is configured, ingested chunks are also written to
doc_chunks (pgvector) so the index survives restarts; see store/supabase.py.
"""

import logging
import math
import uuid
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from ..llm.embeddings import cosine, normalize, try_embed
from ..pipelines.ingest import SourceDoc, chunk_text, parse_frontmatter

log = logging.getLogger(__name__)

# Common Hinglish/Hindi words mapped to English so keyword scoring works across scripts.
SYNONYMS = {
    "janm": "birth", "जन्म": "birth", "praman": "certificate", "प्रमाण": "certificate",
    "पत्र": "certificate", "patra": "certificate", "mrityu": "death", "मृत्यु": "death",
    "pani": "water", "पानी": "water", "jal": "water", "जल": "water", "connection": "connection",
    "कनेक्शन": "connection", "bijli": "electricity", "बिजली": "electricity",
    "ghar": "house", "घर": "house", "grihkar": "property", "गृहकर": "property", "tax": "tax",
    "कर": "tax", "pension": "pension", "पेंशन": "pension", "aay": "income", "आय": "income",
    "jati": "caste", "जाति": "caste", "niwas": "domicile", "निवास": "domicile",
    "ration": "ration", "राशन": "ration", "card": "card", "कार्ड": "card",
    "pay": "pay", "bhugtan": "pay", "भुगतान": "pay", "jama": "pay", "जमा": "pay",
    "online": "online", "ऑनलाइन": "online", "shikayat": "complaint", "शिकायत": "complaint",
    "vivah": "marriage", "विवाह": "marriage", "shaadi": "marriage", "शादी": "marriage",
    "licence": "license", "dukan": "shop", "दुकान": "shop", "naksha": "map", "नक्शा": "map",
    "pata": "address", "पता": "address", "badlav": "change", "बदलाव": "change",
    "kaise": "how", "कैसे": "how", "kahan": "where", "कहाँ": "where", "kitna": "fee",
    "fees": "fee", "शुल्क": "fee", "shulk": "fee", "dastavez": "documents",
    "दस्तावेज": "documents", "kagaz": "documents",
}
STOP = {"how", "do", "i", "the", "a", "an", "to", "of", "for", "in", "is", "my", "me", "get",
        "kaise", "karein", "kare", "karen", "ka", "ki", "ke", "hai", "mein", "se", "what",
        "कैसे", "करें", "का", "की", "के", "है", "में", "से", "और", "को", "where", "can"}


def keywords(text: str) -> list[str]:
    out = []
    for w in normalize(text).split():
        w = SYNONYMS.get(w, w)
        if w not in STOP and len(w) > 1:
            out.append(w)
    return out


@dataclass
class IndexedChunk:
    id: str
    source: SourceDoc
    content: str
    ordinal: int
    vector: list[float] | None
    terms: Counter


@dataclass
class Hit:
    chunk: IndexedChunk
    score: float


class Retriever:
    def __init__(self):
        self.chunks: list[IndexedChunk] = []
        self.sources: dict[str, SourceDoc] = {}
        self._df: Counter = Counter()

    async def add(self, doc: SourceDoc) -> list[IndexedChunk]:
        self.remove(doc.id)
        self.sources[doc.id] = doc
        texts = chunk_text(doc.body, doc.title)
        vecs = await try_embed(texts) or [None] * len(texts)
        added = []
        for i, (t, v) in enumerate(zip(texts, vecs, strict=False)):
            terms = Counter(keywords(t + " " + " ".join(doc.meta.get("tags", []))))
            c = IndexedChunk(str(uuid.uuid5(uuid.NAMESPACE_URL, f"{doc.id}#{i}")), doc, t, i, v,
                             terms)
            self.chunks.append(c)
            self._df.update(set(terms))
            added.append(c)
        return added

    def remove(self, source_id: str) -> None:
        if source_id not in self.sources:
            return
        for c in [c for c in self.chunks if c.source.id == source_id]:
            self._df.subtract(set(c.terms))
        self.chunks = [c for c in self.chunks if c.source.id != source_id]
        del self.sources[source_id]

    async def load_dir(self, path: Path) -> int:
        if not path.exists():
            log.warning("corpus dir %s missing", path)
            return 0
        for f in sorted(path.glob("*.md")):
            meta, body = parse_frontmatter(f.read_text(encoding="utf-8"))
            await self.add(SourceDoc(id=f.stem, title=meta.get("title", f.stem), body=body,
                                     meta=meta))
        return len(self.chunks)

    def _keyword_score(self, q_terms: list[str], c: IndexedChunk) -> float:
        n = max(len(self.chunks), 1)
        score = 0.0
        for t in set(q_terms):
            if t in c.terms:
                idf = math.log(1 + n / (1 + self._df[t]))
                score += idf * (1 + math.log(c.terms[t]))
        return score

    async def search(self, query: str, k: int = 4) -> list[Hit]:
        if not self.chunks:
            return []
        q_terms = keywords(query)
        qv = await try_embed([query])
        raw = []
        for c in self.chunks:
            kw = self._keyword_score(q_terms, c)
            vec = cosine(qv[0], c.vector) if qv and c.vector is not None else 0.0
            raw.append((c, kw, vec))
        max_kw = max((r[1] for r in raw), default=0) or 1.0
        hits = [Hit(c, 0.6 * (kw / max_kw) + 0.4 * max(vec, 0)) for c, kw, vec in raw]
        hits.sort(key=lambda h: h.score, reverse=True)
        return [h for h in hits[:k] if h.score > 0.05]


_retriever: Retriever | None = None


def get_retriever() -> Retriever:
    global _retriever
    if _retriever is None:
        _retriever = Retriever()
    return _retriever
