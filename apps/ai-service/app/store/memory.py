import numpy as np

from ..schemas import ActionPlan, Cluster, Report, ReportEvent
from .base import OPEN_STATUSES, haversine_m


class MemoryStore:
    kind = "memory"

    def __init__(self):
        self.reports: dict[str, Report] = {}
        self.report_vecs: dict[str, list[float]] = {}
        self.events_by_report: dict[str, list[ReportEvent]] = {}
        self.clusters: dict[str, Cluster] = {}
        self.cluster_vecs: dict[str, list[float]] = {}
        self.feedback: list[tuple[str, int | None, bool, str | None]] = []

    async def add_report(self, r, embedding):
        self.reports[r.id] = r
        if embedding is not None:
            self.report_vecs[r.id] = embedding

    async def update_report(self, r):
        self.reports[r.id] = r

    async def get_report(self, report_id):
        return self.reports.get(report_id)

    async def list_reports(self, *, user_id=None, cluster_id=None):
        out = list(self.reports.values())
        if user_id:
            out = [r for r in out if r.user_id == user_id]
        if cluster_id:
            out = [r for r in out if r.cluster_id == cluster_id]
        return sorted(out, key=lambda r: r.created_at, reverse=True)

    async def add_event(self, e: ReportEvent):
        self.events_by_report.setdefault(e.report_id, []).append(e)

    async def events(self, report_id):
        return list(self.events_by_report.get(report_id, []))

    async def add_cluster(self, c, embedding):
        self.clusters[c.id] = c
        if embedding is not None:
            self.cluster_vecs[c.id] = embedding

    async def update_cluster(self, c, embedding=None):
        self.clusters[c.id] = c
        if embedding is not None:
            self.cluster_vecs[c.id] = embedding

    async def get_cluster(self, cluster_id):
        return self.clusters.get(cluster_id)

    async def list_clusters(self, *, ward=None):
        out = list(self.clusters.values())
        if ward:
            out = [c for c in out if c.ward == ward]
        return sorted(out, key=lambda c: c.priority, reverse=True)

    async def nearby_open_clusters(self, lat, lng, radius_m, category):
        out = []
        for c in self.clusters.values():
            if c.category != category or c.status not in OPEN_STATUSES:
                continue
            d = haversine_m(lat, lng, c.centroid.lat, c.centroid.lng)
            if d <= radius_m:
                out.append((c, d, self.cluster_vecs.get(c.id)))
        return sorted(out, key=lambda x: x[1])

    async def save_plan(self, p: ActionPlan):
        c = self.clusters.get(p.cluster_id)
        if c:
            c.plan = p

    async def add_feedback(self, report_id, rating, confirmed, comment):
        self.feedback.append((report_id, rating, confirmed, comment))

    async def feedback_stats(self):
        ratings = [f[1] for f in self.feedback if f[1] is not None]
        disputes = sum(1 for f in self.feedback if not f[2])
        return (float(np.mean(ratings)) if ratings else None), disputes, len(self.feedback)
