"""Persistence interface for reports, clusters, plans and their audit trail.

MemoryStore runs the demo with no database. SupabaseStore writes to the Postgres schema in
supabase/migrations through PostgREST with the service key.
"""

import math
from typing import Protocol

from ..schemas import ActionPlan, Cluster, Report, ReportEvent

OPEN_STATUSES = {"submitted", "triaged", "clustered", "planned", "awaiting_approval", "assigned",
                 "in_progress", "reopened"}


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class Store(Protocol):
    kind: str

    async def add_report(self, r: Report, embedding: list[float] | None) -> None: ...
    async def update_report(self, r: Report) -> None: ...
    async def get_report(self, report_id: str) -> Report | None: ...
    async def list_reports(self, *, user_id: str | None = None,
                           cluster_id: str | None = None) -> list[Report]: ...
    async def add_event(self, e: ReportEvent) -> None: ...
    async def events(self, report_id: str) -> list[ReportEvent]: ...

    async def add_cluster(self, c: Cluster, embedding: list[float] | None) -> None: ...
    async def update_cluster(self, c: Cluster, embedding: list[float] | None = None) -> None: ...
    async def get_cluster(self, cluster_id: str) -> Cluster | None: ...
    async def list_clusters(self, *, ward: str | None = None) -> list[Cluster]: ...
    async def nearby_open_clusters(self, lat: float, lng: float, radius_m: float,
                                   category: str) -> list[tuple[Cluster, float,
                                                                list[float] | None]]: ...

    async def save_plan(self, p: ActionPlan) -> None: ...
    async def add_feedback(self, report_id: str, rating: int | None, confirmed: bool,
                           comment: str | None) -> None: ...
    async def feedback_stats(self) -> tuple[float | None, int, int]:
        """(average rating, disputes, total feedback)."""
        ...
