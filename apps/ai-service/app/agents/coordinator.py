"""Coordinator agent: applies an officer's decision and fans status out to every report."""

from datetime import timedelta

from ..schemas import Cluster, PlanDecision, ReportStatus
from ..store.base import Store
from .common import TransitionError, check_transition, department_by_id, event, now


async def set_cluster_status(store: Store, c: Cluster, status: ReportStatus, note: str,
                             actor: str) -> None:
    c.status = status
    c.updated_at = now()
    await store.update_cluster(c)
    for r in await store.list_reports(cluster_id=c.id):
        if r.status in {"verified", "rejected"}:
            continue
        r.status = status
        await store.update_report(r)
        await store.add_event(event(r.id, status, note, actor))


async def decide(store: Store, c: Cluster, d: PlanDecision, officer: str) -> Cluster:
    if c.plan is None:
        raise TransitionError("cluster has no plan")
    if c.status not in {"awaiting_approval", "reopened"}:
        raise TransitionError(f"cluster is {c.status}, not awaiting approval")
    plan = c.plan
    if d.decision == "edit":
        if d.steps:
            plan.steps = [s.strip() for s in d.steps if s.strip()]
        if d.department_id:
            dept = department_by_id(d.department_id)
            if not dept:
                raise TransitionError("unknown department")
            plan.department_id, plan.department_name = dept["id"], dept["name"]
        if d.sla_hours:
            plan.sla_hours = d.sla_hours
        plan.officer_note = d.note
        await store.save_plan(plan)
        return c

    if d.decision == "reject":
        plan.status = "rejected"
        plan.officer_note = d.note or "Rejected by officer"
        await store.save_plan(plan)
        await set_cluster_status(store, c, "rejected",
                                 f"Closed by officer: {plan.officer_note}", officer)
        return c

    check_transition(c.status, "assigned")
    plan.status = "approved"
    plan.officer_note = d.note
    plan.due_at = now() + timedelta(hours=plan.sla_hours)
    await store.save_plan(plan)
    await set_cluster_status(
        store, c, "assigned",
        f"Assigned to {plan.department_name}; target {plan.due_at:%d %b %Y %H:%M} UTC", officer)
    return c


async def update_progress(store: Store, c: Cluster, status: ReportStatus, note: str | None,
                          officer: str) -> Cluster:
    check_transition(c.status, status)
    default = {"in_progress": "Work started", "resolved": "Marked fixed — please confirm"}
    await set_cluster_status(store, c, status, note or default[status], officer)
    return c
