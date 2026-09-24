"""API contracts. Mirrored in packages/shared/src/index.ts — keep both in sync."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Lang = Literal["hi", "en"]
Category = Literal["waste", "water_drainage", "roads", "streetlights", "public_infra"]
ReportStatus = Literal[
    "submitted", "triaged", "clustered", "planned", "awaiting_approval", "assigned",
    "in_progress", "resolved", "verified", "reopened", "rejected",
]
NoticeType = Literal[
    "property_tax", "water_bill", "electricity_bill", "encroachment", "building_violation",
    "traffic_challan", "court_summons", "general",
]


# ---------- Notice decoder ----------

class Field_(BaseModel):
    value: str | float | None = None
    confidence: float = Field(0.0, ge=0, le=1)


class NoticeFields(BaseModel):
    notice_type: Field_ = Field_()
    authority: Field_ = Field_()
    amount: Field_ = Field_()
    deadline: Field_ = Field_()
    penalty: Field_ = Field_()
    reference: Field_ = Field_()
    period: Field_ = Field_()


class Citation(BaseModel):
    title: str
    url: str | None = None
    source_id: str


class Explanation(BaseModel):
    what_it_is: str
    what_you_owe: str | None = None
    deadline: str | None = None
    if_you_miss_it: str | None = None
    do_this_now: list[str] = []


class DecodeRequest(BaseModel):
    text: str | None = None
    file_path: str | None = None  # path inside the Supabase "notices" bucket
    language: Lang = "hi"


class DecodeResponse(BaseModel):
    ocr_text: str
    masked_text: str
    fields: NoticeFields
    explanation: Explanation
    confidence: float
    low_confidence_fields: list[str]
    citations: list[Citation]
    provider: str
    disclaimer: str


# ---------- Service navigator ----------

class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    language: Lang | None = None
    stream: bool = False


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation]
    language: Lang
    provider: str


# ---------- Scheme finder ----------

IncomeBand = Literal["below_50k", "50k_1l", "1l_2_5l", "2_5l_5l", "5l_8l", "above_8l"]


class SchemeAnswers(BaseModel):
    age: int = Field(ge=0, le=120)
    gender: Literal["female", "male", "other"]
    income_band: IncomeBand
    occupation: Literal[
        "farmer", "street_vendor", "daily_wage", "salaried", "self_employed", "student",
        "homemaker", "artisan", "unemployed", "retired",
    ]
    category: Literal["general", "obc", "sc", "st", "ews"]
    district: str
    # Optional situations that some schemes depend on.
    widowed: bool = False
    disability: bool = False
    language: Lang = "hi"


class SchemeMatch(BaseModel):
    id: str
    name: str
    status: Literal["eligible", "needs_check"]
    reasons: list[str]
    checks: list[str]
    benefit: str
    documents: list[str]
    apply_url: str | None
    source_url: str | None
    explanation: str


class SchemeMatchResponse(BaseModel):
    matches: list[SchemeMatch]
    evaluated: int
    provider: str


# ---------- Speech ----------

class SttResponse(BaseModel):
    text: str
    language: str | None
    provider: str


# ---------- Reports ----------

class Location(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str | None = None


class TriageRequest(BaseModel):
    text: str = Field(default="", max_length=4000)
    category: Category | None = None
    location: Location
    photo_path: str | None = None
    has_photo: bool = False
    transcript: str | None = None
    ward: str | None = None


class ReportEvent(BaseModel):
    id: str
    report_id: str
    status: ReportStatus
    note: str
    actor: str
    created_at: datetime


class Report(BaseModel):
    id: str
    user_id: str | None
    text: str
    category: Category
    severity: int
    location: Location
    ward: str | None
    status: ReportStatus
    cluster_id: str | None
    photo_path: str | None = None
    language: Lang
    flags: list[str] = []
    created_at: datetime


class ActionPlan(BaseModel):
    id: str
    cluster_id: str
    department_id: str
    department_name: str
    steps: list[str]
    sla_hours: int
    due_at: datetime | None = None
    status: Literal["draft", "approved", "rejected"]
    officer_note: str | None = None
    drafted_by: str
    created_at: datetime


class Cluster(BaseModel):
    id: str
    category: Category
    title: str
    centroid: Location
    ward: str | None
    report_count: int
    severity: int
    priority: float
    status: ReportStatus
    plan: ActionPlan | None = None
    created_at: datetime
    updated_at: datetime


class TriageResponse(BaseModel):
    report: Report
    cluster: Cluster
    merged: bool
    similarity: float | None
    timeline: list[ReportEvent]


class PlanDecision(BaseModel):
    decision: Literal["approve", "edit", "reject"]
    steps: list[str] | None = None
    department_id: str | None = None
    sla_hours: int | None = Field(default=None, ge=1, le=24 * 60)
    note: str | None = None


class StatusUpdate(BaseModel):
    status: Literal["in_progress", "resolved"]
    note: str | None = None


class VerifyResponse(BaseModel):
    verdict: Literal["fixed", "not_fixed", "uncertain"]
    change_score: float
    report: Report
    note: str


class FeedbackRequest(BaseModel):
    confirmed: bool
    rating: int | None = Field(default=None, ge=1, le=5)
    comment: str | None = None


class Analytics(BaseModel):
    by_category: dict[str, int]
    by_status: dict[str, int]
    avg_resolution_hours: float | None
    reopen_rate: float
    satisfaction: float | None
    sla_breaches: int


# ---------- Admin ----------

class IngestRequest(BaseModel):
    title: str
    content: str = Field(min_length=20)
    url: str | None = None
    kind: Literal["service", "scheme", "notice_guide", "other"] = "service"
    language: Lang = "en"


class Chunk(BaseModel):
    id: str
    source_id: str
    content: str
    ordinal: int


class IngestResponse(BaseModel):
    source_id: str
    chunks: list[Chunk]


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    providers: dict[str, bool]
    store: str
    embed_provider: str
    corpus_chunks: int
    version: str

