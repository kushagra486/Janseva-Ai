"""Collapse hits to one per source and keep the best-scoring ones, for clean citations."""

from .retriever import Hit


def rerank(hits: list[Hit], max_sources: int = 2, min_ratio: float = 0.5) -> list[Hit]:
    if not hits:
        return []
    best: dict[str, Hit] = {}
    for h in hits:
        sid = h.chunk.source.id
        if sid not in best or h.score > best[sid].score:
            best[sid] = h
    ranked = sorted(best.values(), key=lambda h: h.score, reverse=True)
    top = ranked[0].score
    return [h for h in ranked[:max_sources] if h.score >= top * min_ratio]
