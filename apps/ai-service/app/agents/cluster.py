"""Clustering agent: merge a new report into an open nearby issue of the same category.

Score = 0.6 * text similarity + 0.4 * proximity, over clusters within CLUSTER_RADIUS_M.
Very close reports (under NEAR_M metres) of the same category merge even with different wording,
since people describe the same pothole in very different words.
"""

from ..config import get_settings
from ..llm.embeddings import cosine
from ..schemas import Cluster
from ..store.base import Store

NEAR_M = 50


async def find_match(store: Store, lat: float, lng: float, category: str,
                     vec: list[float] | None
                     ) -> tuple[Cluster | None, float | None, list[float] | None]:
    """Returns (cluster, text similarity, cluster embedding) or (None, None, None)."""
    s = get_settings()
    candidates = await store.nearby_open_clusters(lat, lng, s.cluster_radius_m, category)
    best, best_score, best_sim, best_vec = None, 0.0, None, None
    for c, dist, cvec in candidates:
        sim = cosine(vec, cvec) if vec is not None and cvec is not None else 0.5
        proximity = 1 - dist / s.cluster_radius_m
        score = 0.6 * max(sim, 0) + 0.4 * proximity
        if dist < NEAR_M:
            score = max(score, s.cluster_min_score)
        if score > best_score:
            best, best_score, best_sim, best_vec = c, score, sim, cvec
    if best is not None and best_score >= s.cluster_min_score:
        return best, (round(best_sim, 3) if best_sim is not None else None), best_vec
    return None, None, None


def merged_vector(old: list[float] | None, n: int, new: list[float] | None) -> list[float] | None:
    """Running mean of member embeddings; n is the member count before adding `new`."""
    if new is None:
        return old
    if old is None:
        return new
    return [(o * n + x) / (n + 1) for o, x in zip(old, new, strict=False)]
