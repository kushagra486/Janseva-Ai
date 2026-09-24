"""The reporting pipeline: intake → investigator → clustering → planner → officer review.

Each node takes and returns a TriageState. The graph stops at `awaiting_approval`: that is the
human-in-the-loop interrupt. It resumes only through coordinator.decide(), called when an
officer approves, edits or rejects the plan.

The nodes are plain async functions so the pipeline is easy to test; they map one-to-one onto
LangGraph nodes if you want checkpointed, resumable runs (see docs/architecture.md).
"""

from dataclasses import dataclass, field

from ..llm.embeddings import try_embed
from ..llm.gateway import LLMGateway
from ..privacy.pii_mask import mask_pii
from ..schemas import Cluster, Report, ReportEvent, TriageRequest
from ..store.base import Store
from . import cluster as cluster_agent
from . import intake, investigator, planner
from .common import event, nearest_ward, new_id, now


@dataclass
class TriageState:
    req: TriageRequest
    user_id: str | None
    text: str = ""
    masked: str = ""
    report: Report | None = None
    vector: list[float] | None = None
    cluster: Cluster | None = None
    merged: bool = False
    similarity: float | None = None
    events: list[ReportEvent] = field(default_factory=list)


async def intake_node(st: TriageState, gateway: LLMGateway) -> TriageState:
    text = " ".join(t for t in [st.req.text, st.req.transcript] if t).strip()
    st.text = text
    st.masked, _ = mask_pii(text)
    lang = intake.detect_language(text) if text else "hi"
    if st.req.category:
        category = st.req.category
    else:
        category, conf = intake.classify(st.masked)
        if conf < 0.6:
            llm = await intake.llm_classify(gateway, st.masked)
            if llm:
                category = llm["category"]
    rid = new_id()
    st.report = Report(
        id=rid, user_id=st.user_id, text=st.masked, category=category, severity=2,
        location=st.req.location,
        ward=st.req.ward or nearest_ward(st.req.location.lat, st.req.location.lng),
        status="triaged", cluster_id=None, photo_path=st.req.photo_path, language=lang,
        created_at=now())
    st.events += [event(rid, "submitted", "Report received", "citizen"),
                  event(rid, "triaged", f"Classified as {category.replace('_', ' ')}",
                        "intake-agent")]
    return st


async def investigator_node(st: TriageState) -> TriageState:
    r = st.report
    r.severity, r.flags = investigator.assess(st.masked, r.category,
                                              st.req.has_photo or bool(st.req.photo_path))
    return st


async def cluster_node(st: TriageState, store: Store) -> TriageState:
    r = st.report
    vecs = await try_embed([st.masked or r.category])
    st.vector = vecs[0] if vecs else None
    match, sim, old_vec = await cluster_agent.find_match(store, r.location.lat, r.location.lng,
                                                r.category, st.vector)
    if match:
        n = match.report_count
        match.centroid.lat = (match.centroid.lat * n + r.location.lat) / (n + 1)
        match.centroid.lng = (match.centroid.lng * n + r.location.lng) / (n + 1)
        match.report_count = n + 1
        match.severity = max(match.severity, r.severity)
        age_h = (now() - match.created_at).total_seconds() / 3600
        match.priority = planner.priority(match.severity, match.report_count, age_h)
        match.updated_at = now()
        await store.update_cluster(match, cluster_agent.merged_vector(old_vec, n, st.vector))
        r.cluster_id, r.status = match.id, "clustered"
        st.cluster, st.merged, st.similarity = match, True, sim
        st.events.append(event(r.id, "clustered",
                               f"Merged with {n} similar report(s) nearby", "cluster-agent"))
        # Joining an issue that is already being worked on: inherit its status.
        if match.status in {"assigned", "in_progress"}:
            r.status = match.status
            st.events.append(event(r.id, match.status, "Already assigned to "
                                   f"{match.plan.department_name if match.plan else 'a team'}",
                                   "coordinator-agent"))
    else:
        title = (st.masked[:80] + "…") if len(st.masked) > 80 else (st.masked or r.category)
        c = Cluster(id=new_id(), category=r.category, title=title, centroid=r.location.model_copy(),
                    ward=r.ward, report_count=1, severity=r.severity,
                    priority=planner.priority(r.severity, 1), status="planned",
                    created_at=now(), updated_at=now())
        await store.add_cluster(c, st.vector)
        r.cluster_id = c.id
        st.cluster = c
    return st


async def planner_node(st: TriageState, store: Store, gateway: LLMGateway) -> TriageState:
    r, c = st.report, st.cluster
    if st.merged and c.plan is not None:
        return st
    plan = await planner.draft_plan(c, [r.text], gateway)
    await store.save_plan(plan)
    c.plan = plan
    c.status = "awaiting_approval"
    await store.update_cluster(c)
    if r.status in {"triaged", "clustered"}:
        st.events.append(event(r.id, "planned",
                               f"Action plan drafted for {plan.department_name}", "planner-agent"))
        r.status = "awaiting_approval"
        st.events.append(event(r.id, "awaiting_approval", "Waiting for officer approval",
                               "planner-agent"))
    return st


async def run_triage(req: TriageRequest, user_id: str | None, store: Store,
                     gateway: LLMGateway) -> TriageState:
    st = TriageState(req=req, user_id=user_id)
    st = await intake_node(st, gateway)
    st = await investigator_node(st)
    st = await cluster_node(st, store)
    st = await planner_node(st, store, gateway)
    if st.report.status == "clustered":
        st.report.status = st.cluster.status
    await store.add_report(st.report, st.vector)
    for e in st.events:
        await store.add_event(e)
    return st
