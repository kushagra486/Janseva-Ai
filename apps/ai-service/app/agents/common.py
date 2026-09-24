import json
import uuid
from datetime import UTC, datetime
from functools import lru_cache

from ..config import get_settings
from ..schemas import ReportEvent, ReportStatus
from ..store.base import haversine_m


def now() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid.uuid4())


def event(report_id: str, status: ReportStatus, note: str, actor: str) -> ReportEvent:
    return ReportEvent(id=new_id(), report_id=report_id, status=status, note=note, actor=actor,
                       created_at=now())


@lru_cache
def departments() -> list[dict]:
    return json.loads((get_settings().data_dir / "departments.json").read_text("utf-8"))


def department_for(category: str) -> dict:
    return next(d for d in departments() if category in d["categories"])


def department_by_id(dept_id: str) -> dict | None:
    return next((d for d in departments() if d["id"] == dept_id), None)


@lru_cache
def wards() -> list[dict]:
    return json.loads((get_settings().data_dir / "wards.json").read_text("utf-8"))


def nearest_ward(lat: float, lng: float) -> str | None:
    ws = wards()
    if not ws:
        return None
    w = min(ws, key=lambda w: haversine_m(lat, lng, w["lat"], w["lng"]))
    return w["id"] if haversine_m(lat, lng, w["lat"], w["lng"]) < 8000 else None


# Allowed lifecycle transitions (see the report lifecycle diagram in the README).
TRANSITIONS: dict[str, set[str]] = {
    "submitted": {"triaged"},
    "triaged": {"clustered", "planned"},
    "clustered": {"planned", "awaiting_approval", "assigned", "in_progress"},
    "planned": {"awaiting_approval"},
    "awaiting_approval": {"assigned", "rejected", "awaiting_approval"},
    "assigned": {"in_progress", "resolved"},
    "in_progress": {"resolved"},
    "resolved": {"verified", "reopened"},
    "reopened": {"assigned", "awaiting_approval"},
    "verified": set(),
    "rejected": set(),
}


class TransitionError(ValueError):
    pass


def check_transition(src: str, dst: str) -> None:
    if dst not in TRANSITIONS.get(src, set()):
        raise TransitionError(f"cannot move from {src} to {dst}")
