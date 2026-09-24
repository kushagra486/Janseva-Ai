import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..agents import coordinator, verifier
from ..agents.common import TransitionError, departments, event, now
from ..agents.graph import run_triage
from ..deps import User, check_owned_path, current_user, download_object, require_role
from ..llm.gateway import get_gateway
from ..schemas import (
    Analytics,
    Cluster,
    FeedbackRequest,
    PlanDecision,
    Report,
    StatusUpdate,
    TriageRequest,
    TriageResponse,
    VerifyResponse,
)
from ..store import get_store

router = APIRouter(prefix="/v1", tags=["shikayat", "prashasan"])

RATE_LIMIT = 10  # reports per user per hour
_recent: dict[str, deque] = defaultdict(deque)


def _rate_limit(user_id: str) -> None:
    q, t = _recent[user_id], time.monotonic()
    while q and t - q[0] > 3600:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        raise HTTPException(429, "Too many reports in the last hour. Please try later.")
    q.append(t)


async def _cluster_or_404(cluster_id: str) -> Cluster:
    c = await get_store().get_cluster(cluster_id)
    if not c:
        raise HTTPException(404, "Issue not found")
    return c


def _check_ward(user: User, c: Cluster) -> None:
    if user.role == "officer" and user.ward and c.ward and c.ward != user.ward:
        raise HTTPException(403, "This issue is outside your ward")


# ---------- Citizen ----------

@router.post("/reports/triage", response_model=TriageResponse)
async def triage(req: TriageRequest, user: User = Depends(current_user)):
    if not (req.text.strip() or req.transcript or req.category):
        raise HTTPException(422, "Describe the problem, record a voice note, or pick a category")
    if req.photo_path:
        check_owned_path(user, req.photo_path)
    _rate_limit(user.id or "anon")
    st = await run_triage(req, user.id, get_store(), get_gateway())
    return TriageResponse(report=st.report, cluster=st.cluster, merged=st.merged,
                          similarity=st.similarity, timeline=st.events)


@router.get("/reports/mine", response_model=list[Report])
async def my_reports(user: User = Depends(current_user)):
    return await get_store().list_reports(user_id=user.id)


@router.get("/reports/{report_id}")
async def report_detail(report_id: str, user: User = Depends(current_user)):
    store = get_store()
    r = await store.get_report(report_id)
    if not r:
        raise HTTPException(404, "Report not found")
    c = await store.get_cluster(r.cluster_id) if r.cluster_id else None
    # The timeline is public (it holds no personal data); the report text is the owner's.
    is_owner = user.id == r.user_id or user.role in ("officer", "admin")
    return {"report": r if is_owner else None,
            "cluster": c,
            "timeline": [e.model_dump() for e in await store.events(report_id)]}


@router.post("/reports/{report_id}/verify", response_model=VerifyResponse)
async def verify(report_id: str, after: UploadFile = File(...),
                 before: UploadFile | None = File(None), user: User = Depends(current_user)):
    store = get_store()
    r = await store.get_report(report_id)
    if not r:
        raise HTTPException(404, "Report not found")
    if r.user_id != user.id and user.role == "citizen":
        raise HTTPException(403, "Only the person who reported this can verify it")
    if r.status != "resolved":
        raise HTTPException(409, "This report is not marked resolved yet")
    after_bytes = await after.read()
    if before is not None:
        before_bytes = await before.read()
    elif r.photo_path:
        before_bytes, _ = await download_object("reports", r.photo_path)
    else:
        raise HTTPException(422, "No before photo on file; please attach one")
    try:
        score = verifier.change_score(before_bytes, after_bytes)
    except Exception as e:  # noqa: BLE001 - PIL raises many types for bad images
        raise HTTPException(422, "Could not read one of the photos") from e
    v, note = verifier.verdict(score)
    await store.add_event(event(r.id, "resolved", f"Verifier agent: {note} (change {score})",
                                "verifier-agent"))
    return VerifyResponse(verdict=v, change_score=score, report=r, note=note)


@router.post("/reports/{report_id}/feedback", response_model=Report)
async def feedback(report_id: str, fb: FeedbackRequest, user: User = Depends(current_user)):
    store = get_store()
    r = await store.get_report(report_id)
    if not r:
        raise HTTPException(404, "Report not found")
    if r.user_id != user.id:
        raise HTTPException(403, "Only the person who reported this can confirm the fix")
    if r.status != "resolved":
        raise HTTPException(409, "This report is not marked resolved yet")
    await store.add_feedback(r.id, fb.rating, fb.confirmed, fb.comment)
    c = await store.get_cluster(r.cluster_id)
    if fb.confirmed:
        r.status = "verified"
        await store.update_report(r)
        await store.add_event(event(r.id, "verified", "Citizen confirmed the fix", "citizen"))
        # The issue closes once every member report is verified.
        members = await store.list_reports(cluster_id=c.id)
        if all(m.status == "verified" for m in members):
            c.status, c.updated_at = "verified", now()
            await store.update_cluster(c)
    else:
        note = f"Citizen disputed the fix: {fb.comment}" if fb.comment else \
            "Citizen disputed the fix"
        await coordinator.set_cluster_status(store, c, "reopened", note, "feedback-agent")
        # Back to the officer: the plan needs a fresh decision.
        if c.plan:
            c.plan.status = "draft"
            await store.save_plan(c.plan)
        r = await store.get_report(r.id)
    return r


# ---------- Officer ----------

@router.get("/clusters", response_model=list[Cluster])
async def clusters(user: User = Depends(require_role("officer", "admin"))):
    return await get_store().list_clusters(ward=user.ward if user.role == "officer" else None)


@router.get("/clusters/{cluster_id}")
async def cluster_detail(cluster_id: str, user: User = Depends(require_role("officer", "admin"))):
    c = await _cluster_or_404(cluster_id)
    _check_ward(user, c)
    return {"cluster": c, "reports": await get_store().list_reports(cluster_id=cluster_id)}


@router.post("/clusters/{cluster_id}/decision", response_model=Cluster)
async def decide(cluster_id: str, d: PlanDecision,
                 user: User = Depends(require_role("officer", "admin"))):
    c = await _cluster_or_404(cluster_id)
    _check_ward(user, c)
    try:
        return await coordinator.decide(get_store(), c, d, f"officer:{user.id}")
    except TransitionError as e:
        raise HTTPException(409, str(e)) from e


@router.post("/clusters/{cluster_id}/status", response_model=Cluster)
async def update_status(cluster_id: str, u: StatusUpdate,
                        user: User = Depends(require_role("officer", "admin"))):
    c = await _cluster_or_404(cluster_id)
    _check_ward(user, c)
    try:
        return await coordinator.update_progress(get_store(), c, u.status, u.note,
                                                 f"officer:{user.id}")
    except TransitionError as e:
        raise HTTPException(409, str(e)) from e


@router.get("/departments")
async def list_departments():
    return departments()


@router.get("/analytics", response_model=Analytics)
async def analytics(user: User = Depends(require_role("officer", "admin"))):
    store = get_store()
    cs = await store.list_clusters(ward=user.ward if user.role == "officer" else None)
    by_cat: dict[str, int] = defaultdict(int)
    by_status: dict[str, int] = defaultdict(int)
    for c in cs:
        by_cat[c.category] += 1
        by_status[c.status] += 1
    durations, breaches = [], 0
    t = now()
    for c in cs:
        if c.status in ("resolved", "verified") and c.plan:
            durations.append((c.updated_at - c.plan.created_at).total_seconds() / 3600)
        if (c.plan and c.plan.due_at and c.status in ("assigned", "in_progress")
                and c.plan.due_at < t):
            breaches += 1
    satisfaction, disputes, total_fb = await store.feedback_stats()
    return Analytics(by_category=dict(by_cat), by_status=dict(by_status),
                     avg_resolution_hours=round(sum(durations) / len(durations), 1)
                     if durations else None,
                     reopen_rate=round(disputes / total_fb, 2) if total_fb else 0.0,
                     satisfaction=round(satisfaction, 2) if satisfaction else None,
                     sla_breaches=breaches)


