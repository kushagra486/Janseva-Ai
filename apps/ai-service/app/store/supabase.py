"""Store backed by the Supabase schema (supabase/migrations), via PostgREST.

Uses the service-role key, so row-level security is bypassed here: this service must enforce
roles itself (see deps.py). Citizen-facing reads in the web app go through RLS as usual.
"""

import json
from datetime import UTC, datetime

import httpx

from ..schemas import ActionPlan, Cluster, Location, Report, ReportEvent

PLAN_SELECT = "*,action_plans(*,departments(name))"


def _vec(v: list[float] | None) -> str | None:
    return None if v is None else "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def _parse_vec(v) -> list[float] | None:
    if v is None:
        return None
    return json.loads(v) if isinstance(v, str) else list(v)


class SupabaseStore:
    kind = "supabase"

    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        # Accept-Profile/Content-Profile pick the "janseva" schema (see the 000003 migration)
        # rather than PostgREST's default "public" — this project's database may hold other
        # apps' tables under "public" too, and this keeps every request scoped to JANSEVA's own.
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json", "Accept-Profile": "janseva",
                        "Content-Profile": "janseva"}

    async def _req(self, method: str, path: str, *, params=None, json_body=None,
                   prefer: str | None = None):
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.request(method, f"{self.base}/{path}", params=params,
                                     json=json_body, headers=headers)
            r.raise_for_status()
            return r.json() if r.content else None

    # ----- mapping -----

    @staticmethod
    def _report(row: dict) -> Report:
        return Report(
            id=row["id"], user_id=row.get("user_id"), text=row["text"], category=row["category"],
            severity=row["severity"],
            location=Location(lat=row["lat"], lng=row["lng"], address=row.get("address")),
            ward=row.get("ward"), status=row["status"], cluster_id=row.get("cluster_id"),
            photo_path=row.get("photo_path"), language=row.get("language", "hi"),
            flags=row.get("flags") or [], created_at=row["created_at"])

    @staticmethod
    def _plan(row: dict) -> ActionPlan:
        dept = row.get("departments") or {}
        return ActionPlan(
            id=row["id"], cluster_id=row["cluster_id"], department_id=row["department_id"],
            department_name=dept.get("name", row["department_id"]), steps=row["steps"],
            sla_hours=row["sla_hours"], due_at=row.get("due_at"), status=row["status"],
            officer_note=row.get("officer_note"), drafted_by=row["drafted_by"],
            created_at=row["created_at"])

    def _cluster(self, row: dict) -> Cluster:
        plans = sorted(row.get("action_plans") or [], key=lambda p: p["created_at"])
        return Cluster(
            id=row["id"], category=row["category"], title=row["title"],
            centroid=Location(lat=row["lat"], lng=row["lng"]), ward=row.get("ward"),
            report_count=row["report_count"], severity=row["severity"], priority=row["priority"],
            status=row["status"], plan=self._plan(plans[-1]) if plans else None,
            created_at=row["created_at"], updated_at=row["updated_at"])

    # ----- reports -----

    async def add_report(self, r, embedding):
        body = {"id": r.id, "user_id": r.user_id, "text": r.text, "category": r.category,
                "severity": r.severity, "lat": r.location.lat, "lng": r.location.lng,
                "address": r.location.address, "ward": r.ward, "status": r.status,
                "cluster_id": r.cluster_id, "photo_path": r.photo_path, "language": r.language,
                "flags": r.flags, "embedding": _vec(embedding),
                "created_at": r.created_at.isoformat()}
        await self._req("POST", "reports", json_body=body, prefer="return=minimal")

    async def update_report(self, r):
        await self._req("PATCH", "reports", params={"id": f"eq.{r.id}"},
                        json_body={"status": r.status, "cluster_id": r.cluster_id,
                                   "severity": r.severity, "flags": r.flags},
                        prefer="return=minimal")

    async def get_report(self, report_id):
        rows = await self._req("GET", "reports", params={"id": f"eq.{report_id}",
                                                         "select": "*"})
        return self._report(rows[0]) if rows else None

    async def list_reports(self, *, user_id=None, cluster_id=None):
        params = {"select": "*", "order": "created_at.desc", "limit": "500"}
        if user_id:
            params["user_id"] = f"eq.{user_id}"
        if cluster_id:
            params["cluster_id"] = f"eq.{cluster_id}"
        return [self._report(r) for r in await self._req("GET", "reports", params=params)]

    async def add_event(self, e):
        await self._req("POST", "report_events", json_body={
            "id": e.id, "report_id": e.report_id, "status": e.status, "note": e.note,
            "actor": e.actor, "created_at": e.created_at.isoformat()}, prefer="return=minimal")

    async def events(self, report_id):
        rows = await self._req("GET", "report_events", params={
            "report_id": f"eq.{report_id}", "order": "created_at.asc", "select": "*"})
        return [ReportEvent(**row) for row in rows]

    # ----- clusters -----

    def _cluster_body(self, c: Cluster, embedding) -> dict:
        body = {"id": c.id, "category": c.category, "title": c.title, "lat": c.centroid.lat,
                "lng": c.centroid.lng, "ward": c.ward, "report_count": c.report_count,
                "severity": c.severity, "priority": c.priority, "status": c.status,
                "created_at": c.created_at.isoformat(), "updated_at": c.updated_at.isoformat()}
        if embedding is not None:
            body["embedding"] = _vec(embedding)
        return body

    async def add_cluster(self, c, embedding):
        await self._req("POST", "clusters", json_body=self._cluster_body(c, embedding),
                        prefer="return=minimal")

    async def update_cluster(self, c, embedding=None):
        body = self._cluster_body(c, embedding)
        body.pop("id")
        body.pop("created_at")
        await self._req("PATCH", "clusters", params={"id": f"eq.{c.id}"}, json_body=body,
                        prefer="return=minimal")

    async def get_cluster(self, cluster_id):
        rows = await self._req("GET", "clusters", params={"id": f"eq.{cluster_id}",
                                                          "select": PLAN_SELECT})
        return self._cluster(rows[0]) if rows else None

    async def list_clusters(self, *, ward=None):
        params = {"select": PLAN_SELECT, "order": "priority.desc", "limit": "500"}
        if ward:
            params["ward"] = f"eq.{ward}"
        return [self._cluster(r) for r in await self._req("GET", "clusters", params=params)]

    async def nearby_open_clusters(self, lat, lng, radius_m, category):
        rows = await self._req("POST", "rpc/nearby_open_clusters", json_body={
            "p_lat": lat, "p_lng": lng, "p_radius_m": radius_m, "p_category": category})
        out = []
        for row in rows:
            c = await self.get_cluster(row["id"])
            if c:
                out.append((c, row["distance_m"], _parse_vec(row.get("embedding"))))
        return out

    async def save_plan(self, p):
        body = {"id": p.id, "cluster_id": p.cluster_id, "department_id": p.department_id,
                "steps": p.steps, "sla_hours": p.sla_hours,
                "due_at": p.due_at.isoformat() if p.due_at else None, "status": p.status,
                "officer_note": p.officer_note, "drafted_by": p.drafted_by,
                "created_at": p.created_at.isoformat()}
        await self._req("POST", "action_plans", json_body=body,
                        prefer="resolution=merge-duplicates,return=minimal",
                        params={"on_conflict": "id"})

    async def add_feedback(self, report_id, rating, confirmed, comment):
        await self._req("POST", "report_feedback", json_body={
            "report_id": report_id, "rating": rating, "confirmed": confirmed,
            "comment": comment, "created_at": datetime.now(UTC).isoformat()},
            prefer="return=minimal")

    async def feedback_stats(self):
        rows = await self._req("GET", "report_feedback", params={"select": "rating,confirmed"})
        ratings = [r["rating"] for r in rows if r["rating"] is not None]
        disputes = sum(1 for r in rows if not r["confirmed"])
        return (sum(ratings) / len(ratings) if ratings else None), disputes, len(rows)
