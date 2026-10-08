// Reports/clusters data access via the service-role key over PostgREST. Ported 1:1 from
// apps/ai-service's store/supabase.py. Row-level security is bypassed here (same as the
// Python service did), so every route calling this module must check the caller's role itself
// (see auth.ts) before calling a write.
import "server-only";
import type { ActionPlan, Category, Cluster, Location, Report, ReportEvent, ReportStatus } from "@janseva/shared";
import { SUPABASE_URL } from "../env";

function base(): string {
  return `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
}
function headers(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  return {
    apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json",
    // Scope every request to JANSEVA's own schema on this shared Supabase project.
    "Accept-Profile": "janseva", "Content-Profile": "janseva",
  };
}

async function req(method: string, path: string, opts: { params?: Record<string, string>; body?: unknown; prefer?: string } = {}) {
  const url = new URL(`${base()}/${path}`);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  const h = { ...headers() };
  if (opts.prefer) h.Prefer = opts.prefer;
  const res = await fetch(url, { method, headers: h, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (!res.ok) throw new Error(`supabase ${method} ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const vec = (v: number[] | null): string | null => (v === null ? null : `[${v.map((x) => x.toFixed(6)).join(",")}]`);
const parseVec = (v: unknown): number[] | null => (v == null ? null : typeof v === "string" ? JSON.parse(v) : (v as number[]));

type ReportRow = {
  id: string; user_id: string | null; text: string; category: Category; severity: number;
  lat: number; lng: number; address?: string | null; ward?: string | null; status: ReportStatus;
  cluster_id?: string | null; photo_path?: string | null; language: "hi" | "en"; flags?: string[];
  created_at: string;
};
function toReport(row: ReportRow): Report {
  return {
    id: row.id, user_id: row.user_id, text: row.text, category: row.category, severity: row.severity,
    location: { lat: row.lat, lng: row.lng, address: row.address ?? null }, ward: row.ward ?? null,
    status: row.status, cluster_id: row.cluster_id ?? null, photo_path: row.photo_path ?? null,
    language: row.language, flags: row.flags ?? [], created_at: row.created_at,
  };
}

type PlanRow = {
  id: string; cluster_id: string; department_id: string; departments?: { name: string };
  steps: string[]; sla_hours: number; due_at: string | null; status: ActionPlan["status"];
  officer_note: string | null; drafted_by: string; created_at: string;
};
function toPlan(row: PlanRow): ActionPlan {
  return {
    id: row.id, cluster_id: row.cluster_id, department_id: row.department_id,
    department_name: row.departments?.name ?? row.department_id, steps: row.steps,
    sla_hours: row.sla_hours, due_at: row.due_at, status: row.status,
    officer_note: row.officer_note, drafted_by: row.drafted_by, created_at: row.created_at,
  };
}

type ClusterRow = {
  id: string; category: Category; title: string; lat: number; lng: number; ward?: string | null;
  report_count: number; severity: number; priority: number; status: ReportStatus;
  action_plans?: PlanRow[]; created_at: string; updated_at: string;
};
function toCluster(row: ClusterRow): Cluster {
  const plans = [...(row.action_plans ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    id: row.id, category: row.category, title: row.title,
    centroid: { lat: row.lat, lng: row.lng }, ward: row.ward ?? null,
    report_count: row.report_count, severity: row.severity, priority: row.priority,
    status: row.status, plan: plans.length ? toPlan(plans[plans.length - 1]) : null,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

const PLAN_SELECT = "*,action_plans(*,departments(name))";

export async function addReport(r: Report, embedding: number[] | null): Promise<void> {
  await req("POST", "reports", {
    body: {
      id: r.id, user_id: r.user_id, text: r.text, category: r.category, severity: r.severity,
      lat: r.location.lat, lng: r.location.lng, address: r.location.address ?? null, ward: r.ward,
      status: r.status, cluster_id: r.cluster_id, photo_path: r.photo_path, language: r.language,
      flags: r.flags, embedding: vec(embedding), created_at: r.created_at,
    },
    prefer: "return=minimal",
  });
}
export async function updateReport(r: Report): Promise<void> {
  await req("PATCH", "reports", {
    params: { id: `eq.${r.id}` },
    body: { status: r.status, cluster_id: r.cluster_id, severity: r.severity, flags: r.flags },
    prefer: "return=minimal",
  });
}
export async function getReport(id: string): Promise<Report | null> {
  const rows = (await req("GET", "reports", { params: { id: `eq.${id}`, select: "*" } })) as ReportRow[];
  return rows.length ? toReport(rows[0]) : null;
}
export async function listReports(opts: { userId?: string; clusterId?: string } = {}): Promise<Report[]> {
  const params: Record<string, string> = { select: "*", order: "created_at.desc", limit: "500" };
  if (opts.userId) params.user_id = `eq.${opts.userId}`;
  if (opts.clusterId) params.cluster_id = `eq.${opts.clusterId}`;
  const rows = (await req("GET", "reports", { params })) as ReportRow[];
  return rows.map(toReport);
}
export async function addEvent(e: ReportEvent): Promise<void> {
  await req("POST", "report_events", { body: e, prefer: "return=minimal" });
}
export async function listEvents(reportId: string): Promise<ReportEvent[]> {
  return (await req("GET", "report_events", {
    params: { report_id: `eq.${reportId}`, order: "created_at.asc", select: "*" },
  })) as ReportEvent[];
}

function clusterBody(c: Cluster, embedding: number[] | null | undefined) {
  const body: Record<string, unknown> = {
    id: c.id, category: c.category, title: c.title, lat: c.centroid.lat, lng: c.centroid.lng,
    ward: c.ward, report_count: c.report_count, severity: c.severity, priority: c.priority,
    status: c.status, created_at: c.created_at, updated_at: c.updated_at,
  };
  if (embedding !== undefined && embedding !== null) body.embedding = vec(embedding);
  return body;
}
export async function addCluster(c: Cluster, embedding: number[] | null): Promise<void> {
  await req("POST", "clusters", { body: clusterBody(c, embedding), prefer: "return=minimal" });
}
export async function updateCluster(c: Cluster, embedding?: number[] | null): Promise<void> {
  const body = clusterBody(c, embedding);
  delete body.id;
  delete body.created_at;
  await req("PATCH", "clusters", { params: { id: `eq.${c.id}` }, body, prefer: "return=minimal" });
}
export async function getCluster(id: string): Promise<Cluster | null> {
  const rows = (await req("GET", "clusters", { params: { id: `eq.${id}`, select: PLAN_SELECT } })) as ClusterRow[];
  return rows.length ? toCluster(rows[0]) : null;
}
export async function listClusters(opts: { ward?: string } = {}): Promise<Cluster[]> {
  const params: Record<string, string> = { select: PLAN_SELECT, order: "priority.desc", limit: "500" };
  if (opts.ward) params.ward = `eq.${opts.ward}`;
  const rows = (await req("GET", "clusters", { params })) as ClusterRow[];
  return rows.map(toCluster);
}
export async function nearbyOpenClusters(lat: number, lng: number, radiusM: number, category: string) {
  const rows = (await req("POST", "rpc/nearby_open_clusters", {
    body: { p_lat: lat, p_lng: lng, p_radius_m: radiusM, p_category: category },
  })) as { id: string; distance_m: number; embedding?: unknown }[];
  const out: { cluster: Cluster; distanceM: number; embedding: number[] | null }[] = [];
  for (const row of rows) {
    const c = await getCluster(row.id);
    if (c) out.push({ cluster: c, distanceM: row.distance_m, embedding: parseVec(row.embedding) });
  }
  return out;
}
export async function savePlan(p: ActionPlan): Promise<void> {
  await req("POST", "action_plans", {
    body: {
      id: p.id, cluster_id: p.cluster_id, department_id: p.department_id, steps: p.steps,
      sla_hours: p.sla_hours, due_at: p.due_at, status: p.status, officer_note: p.officer_note,
      drafted_by: p.drafted_by, created_at: p.created_at,
    },
    prefer: "resolution=merge-duplicates,return=minimal",
    params: { on_conflict: "id" },
  });
}
export async function addFeedback(reportId: string, rating: number | null, confirmed: boolean, comment: string | null): Promise<void> {
  await req("POST", "report_feedback", {
    body: { report_id: reportId, rating, confirmed, comment, created_at: new Date().toISOString() },
    prefer: "return=minimal",
  });
}
export async function feedbackStats(): Promise<{ satisfaction: number | null; disputes: number; total: number }> {
  const rows = (await req("GET", "report_feedback", { params: { select: "rating,confirmed" } })) as { rating: number | null; confirmed: boolean }[];
  const ratings = rows.map((r) => r.rating).filter((r): r is number => r !== null);
  const disputes = rows.filter((r) => !r.confirmed).length;
  return { satisfaction: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null, disputes, total: rows.length };
}

export type { Location };
