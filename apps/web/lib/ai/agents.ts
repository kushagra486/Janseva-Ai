// Civic report pipeline: intake -> investigator -> cluster -> planner, run synchronously in
// one request (this already matched apps/ai-service's agents/graph.py: each "agent" there was
// a plain async function called in sequence within a single HTTP request too — there was no
// actual background/resumable orchestration to port). Stops at "awaiting_approval"; an officer
// resumes it via decideCluster(). Cluster text-similarity used a dependency-free hash embedding
// in the original service (see llm/embeddings.py); dropped here in favor of pure geo-proximity
// clustering, the one real simplification agreed for this port.
import "server-only";
import type { ActionPlan, Category, Cluster, Location, Report, ReportEvent, ReportStatus, TriageRequest } from "@janseva/shared";
import departmentsData from "./data/departments.json";
import wardsData from "./data/wards.json";
import { chatJson, LLMUnavailable } from "./groq";
import { maskPii } from "./pii";
import * as store from "./store";

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
function event(reportId: string, status: ReportStatus, note: string, actor: string): ReportEvent {
  return { id: newId(), report_id: reportId, status, note, actor, created_at: now() };
}

type Department = { id: string; name: string; name_hi: string; categories: Category[]; sla_hours: number };
const DEPARTMENTS = departmentsData as Department[];
export function departments() { return DEPARTMENTS; }
export function departmentFor(category: Category): Department {
  const d = DEPARTMENTS.find((d) => d.categories.includes(category));
  if (!d) throw new Error(`no department for category ${category}`);
  return d;
}
export function departmentById(id: string): Department | null {
  return DEPARTMENTS.find((d) => d.id === id) ?? null;
}

const WARDS = wardsData as { id: string; name: string; lat: number; lng: number }[];
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function nearestWard(lat: number, lng: number): string | null {
  if (!WARDS.length) return null;
  let best = WARDS[0], bestD = haversineM(lat, lng, WARDS[0].lat, WARDS[0].lng);
  for (const w of WARDS.slice(1)) {
    const d = haversineM(lat, lng, w.lat, w.lng);
    if (d < bestD) { best = w; bestD = d; }
  }
  return bestD < 8000 ? best.id : null;
}

// ---------- intake ----------

const LEXICON: Record<Category, string[]> = {
  waste: ["garbage", "kachra", "kooda", "kuda", "trash", "waste", "dump", "dustbin", "smell", "कचरा", "कूड़ा", "कूडा", "गंदगी", "कूड़ेदान", "badbu", "बदबू", "safai", "सफाई"],
  water_drainage: ["drain", "nala", "naala", "nali", "sewer", "sewage", "overflow", "water", "leak", "pipeline", "waterlogging", "flood", "pani", "नाला", "नाली", "सीवर", "पानी", "जलभराव", "लीकेज", "पाइपलाइन", "gutter", "गटर", "manhole", "मैनहोल"],
  roads: ["pothole", "road", "gaddha", "gadda", "sadak", "footpath", "broken road", "crack", "गड्ढा", "गड्ढे", "सड़क", "सडक", "फुटपाथ", "speed breaker", "divider"],
  streetlights: ["streetlight", "street light", "light", "lamp", "pole", "andhera", "batti", "स्ट्रीट लाइट", "लाइट", "बत्ती", "अंधेरा", "खंभा", "wire", "तार", "करंट", "current"],
  public_infra: ["park", "toilet", "bench", "bus stop", "tree", "wall", "bridge", "signal", "पार्क", "शौचालय", "पेड़", "पुल", "दीवार", "सिग्नल", "stray", "आवारा"],
};

function detectLanguage(text: string): "hi" | "en" {
  const dev = [...text].filter((ch) => ch >= "ऀ" && ch <= "ॿ").length;
  const letters = [...text].filter((ch) => /[a-zA-Zऀ-ॿ]/.test(ch)).length;
  return letters && dev / letters > 0.3 ? "hi" : "en";
}

function classify(text: string): [Category, number] {
  const low = text.toLowerCase();
  const scores = Object.entries(LEXICON).map(([cat, words]) => {
    const count = words.reduce((n, w) => n + low.split(w.toLowerCase()).length - 1, 0);
    return [cat as Category, count] as const;
  });
  const best = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  const total = scores.reduce((n, [, c]) => n + c, 0);
  if (best[1] === 0) return ["public_infra", 0.3];
  return [best[0], Math.round(Math.min(0.95, 0.5 + 0.5 * (best[1] / total)) * 100) / 100];
}

const CLASSIFY_PROMPT = `Classify a civic complaint from an Indian city. Categories:
waste, water_drainage, roads, streetlights, public_infra.
Return ONLY JSON: {"category": "...", "summary_en": "one short English sentence"}`;

async function llmClassify(maskedText: string): Promise<Category | null> {
  try {
    const data = await chatJson([
      { role: "system", content: CLASSIFY_PROMPT },
      { role: "user", content: maskedText.slice(0, 2000) },
    ]);
    const cat = data.category;
    return typeof cat === "string" && cat in LEXICON ? (cat as Category) : null;
  } catch (e) {
    if (e instanceof LLMUnavailable) return null;
    return null;
  }
}

// ---------- investigator ----------

const BASE_SEVERITY: Record<Category, number> = { waste: 2, water_drainage: 3, roads: 2, streetlights: 2, public_infra: 2 };
const DANGER = /accident|injur|electrocut|current|करंट|shock|open manhole|खुला मैनहोल|मैनहोल खुला|collapse|गिर गया|गिर गई|गिरने|flood|बाढ़|जलभराव|sewage.*(?:house|ghar)|घर में (?:पानी|गंदा)|fire|आग|dead|मौत|बच्च|child|school|स्कूल|hospital|अस्पताल|dengue|डेंगू|malaria/i;
const DURATION = /(\d+)\s*(?:din|दिन|days?|hafte|हफ्ते|weeks?|mahine|महीने|months?)/i;
const URGENT = /urgent|turant|तुरंत|jaldi|जल्दी|emergency|खतरा|khatra|danger/i;

function assess(text: string, category: Category, hasPhoto: boolean): { severity: number; flags: string[] } {
  let sev = BASE_SEVERITY[category] ?? 2;
  const flags: string[] = [];
  if (DANGER.test(text)) { sev += 2; flags.push("safety_risk"); }
  if (URGENT.test(text)) sev += 1;
  const m = DURATION.exec(text);
  if (m && (/week|महीने|हफ्ते/i.test(m[0]) || Number(m[1]) >= 7)) { sev += 1; flags.push("long_pending"); }
  sev = Math.max(1, Math.min(5, sev));
  if (sev > 3 && !hasPhoto) { sev = 3; flags.push("photo_needed_for_high_severity"); }
  if (text.trim().length < 12) flags.push("vague");
  return { severity: sev, flags };
}

// ---------- cluster (proximity-only; see file header) ----------

const CLUSTER_RADIUS_M = 150;
const CLUSTER_MIN_SCORE = 0.55;

async function findMatch(lat: number, lng: number, category: Category): Promise<Cluster | null> {
  const candidates = await store.nearbyOpenClusters(lat, lng, CLUSTER_RADIUS_M, category);
  let best: Cluster | null = null, bestScore = 0;
  for (const { cluster, distanceM } of candidates) {
    const proximity = 1 - distanceM / CLUSTER_RADIUS_M;
    const score = Math.max(0.4 * proximity, distanceM < 50 ? CLUSTER_MIN_SCORE : 0);
    if (score > bestScore) { best = cluster; bestScore = score; }
  }
  return bestScore >= CLUSTER_MIN_SCORE ? best : null;
}

// ---------- planner ----------

const PLAN_STEPS: Record<Category, string[]> = {
  waste: ["Send the ward sanitation team to clear the garbage point.", "Disinfect the spot and place a dustbin if none exists.", "Add the spot to the daily collection route."],
  water_drainage: ["Inspect the drain / sewer line at the reported spot.", "Desilt or clear the blockage with a jetting machine.", "Repair any broken cover or leaking pipe; check nearby lines."],
  roads: ["Inspect and measure the damaged stretch.", "Fill potholes with cold-mix as an immediate fix and barricade if deep.", "Schedule permanent resurfacing if the damage is larger than 5 m²."],
  streetlights: ["Send the lighting contractor to check the pole and fixture.", "Replace the lamp / fix the wiring; isolate exposed wires immediately.", "Confirm the light works after dark."],
  public_infra: ["Inspect the site and assess the damage.", "Assign repair to the responsible section.", "Make the area safe for the public until repaired."],
};

export function priority(severity: number, reportCount: number, ageHours = 0): number {
  return Math.round((severity * (1 + Math.log2(Math.max(reportCount, 1))) + Math.min(ageHours / 24, 5)) * 100) / 100;
}
function slaFor(category: Category, severity: number): number {
  const base = departmentFor(category).sla_hours;
  return severity >= 4 ? Math.max(12, Math.floor(base / 2)) : base;
}

const PLAN_PROMPT = `You are drafting a work order for a municipal officer in Lucknow. Given a
civic issue, return ONLY JSON: {"steps": ["3 to 4 short, concrete imperative steps"]}.
Do not promise dates or money. The officer will review before anything is sent.`;

async function draftPlan(cluster: Cluster, sampleTexts: string[]): Promise<ActionPlan> {
  const dept = departmentFor(cluster.category);
  let steps = [...PLAN_STEPS[cluster.category]];
  let draftedBy = "rules";
  try {
    const data = await chatJson([
      { role: "system", content: PLAN_PROMPT },
      { role: "user", content: `Category: ${cluster.category}. Severity ${cluster.severity}/5. ${cluster.report_count} reports. Examples: ${JSON.stringify(sampleTexts.slice(0, 3))}` },
    ]);
    const llmSteps = Array.isArray(data.steps) ? data.steps.map((s) => String(s).slice(0, 200)).filter((s) => s.trim()) : [];
    if (llmSteps.length >= 2 && llmSteps.length <= 6) { steps = llmSteps; draftedBy = "groq"; }
  } catch {
    /* fall back to rule-based steps */
  }
  return {
    id: newId(), cluster_id: cluster.id, department_id: dept.id, department_name: dept.name,
    steps, sla_hours: slaFor(cluster.category, cluster.severity), due_at: null, status: "draft",
    officer_note: null, drafted_by: draftedBy, created_at: now(),
  };
}

// ---------- the pipeline ----------

export type TriageResult = { report: Report; cluster: Cluster; merged: boolean; similarity: number | null; timeline: ReportEvent[] };

export async function runTriage(req: TriageRequest, userId: string | null): Promise<TriageResult> {
  const text = [req.text, req.transcript].filter(Boolean).join(" ").trim();
  const { masked } = maskPii(text);
  const lang = text ? detectLanguage(text) : "hi";
  let category: Category;
  if (req.category) {
    category = req.category;
  } else {
    const [ruleCat, conf] = classify(masked);
    category = conf < 0.6 ? (await llmClassify(masked)) ?? ruleCat : ruleCat;
  }
  const rid = newId();
  const location: Location = req.location;
  const { severity, flags } = assess(masked, category, req.has_photo || Boolean(req.photo_path));

  let report: Report = {
    id: rid, user_id: userId, text: masked, category, severity, location,
    ward: req.ward ?? nearestWard(location.lat, location.lng), status: "triaged",
    cluster_id: null, photo_path: req.photo_path ?? null, language: lang, flags, created_at: now(),
  };
  const timeline: ReportEvent[] = [
    event(rid, "submitted", "Report received", "citizen"),
    event(rid, "triaged", `Classified as ${category.replace("_", " ")}`, "intake-agent"),
  ];

  const match = await findMatch(location.lat, location.lng, category);
  let cluster: Cluster;
  let merged = false;
  if (match) {
    const n = match.report_count;
    cluster = {
      ...match,
      centroid: { lat: (match.centroid.lat * n + location.lat) / (n + 1), lng: (match.centroid.lng * n + location.lng) / (n + 1) },
      report_count: n + 1,
      severity: Math.max(match.severity, severity),
      updated_at: now(),
    };
    cluster.priority = priority(cluster.severity, cluster.report_count, (Date.now() - new Date(match.created_at).getTime()) / 3_600_000);
    await store.updateCluster(cluster);
    report = { ...report, cluster_id: cluster.id, status: "clustered" };
    merged = true;
    timeline.push(event(rid, "clustered", `Merged with ${n} similar report(s) nearby`, "cluster-agent"));
    if (cluster.status === "assigned" || cluster.status === "in_progress") {
      report.status = cluster.status;
      timeline.push(event(rid, cluster.status, `Already assigned to ${cluster.plan?.department_name ?? "a team"}`, "coordinator-agent"));
    }
  } else {
    const title = masked.length > 80 ? `${masked.slice(0, 80)}…` : masked || category;
    cluster = {
      id: newId(), category, title, centroid: { ...location }, ward: report.ward,
      report_count: 1, severity, priority: priority(severity, 1), status: "planned",
      plan: null, created_at: now(), updated_at: now(),
    };
    await store.addCluster(cluster, null);
    report = { ...report, cluster_id: cluster.id };
  }

  if (!(merged && cluster.plan !== null)) {
    const plan = await draftPlan(cluster, [report.text]);
    await store.savePlan(plan);
    cluster = { ...cluster, plan, status: "awaiting_approval" };
    await store.updateCluster(cluster);
    if (report.status === "triaged" || report.status === "clustered") {
      timeline.push(event(rid, "planned", `Action plan drafted for ${plan.department_name}`, "planner-agent"));
      report.status = "awaiting_approval";
      timeline.push(event(rid, "awaiting_approval", "Waiting for officer approval", "planner-agent"));
    }
  }
  if (report.status === "clustered") report.status = cluster.status;

  await store.addReport(report, null);
  for (const e of timeline) await store.addEvent(e);
  return { report, cluster, merged, similarity: null, timeline };
}

// ---------- coordinator ----------

const TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  submitted: ["triaged"], triaged: ["clustered", "planned"],
  clustered: ["planned", "awaiting_approval", "assigned", "in_progress"], planned: ["awaiting_approval"],
  awaiting_approval: ["assigned", "rejected", "awaiting_approval"], assigned: ["in_progress", "resolved"],
  in_progress: ["resolved"], resolved: ["verified", "reopened"], reopened: ["assigned", "awaiting_approval"],
  verified: [], rejected: [],
};
export class TransitionError extends Error {}
function checkTransition(src: ReportStatus, dst: ReportStatus): void {
  if (!TRANSITIONS[src]?.includes(dst)) throw new TransitionError(`cannot move from ${src} to ${dst}`);
}

async function setClusterStatus(c: Cluster, status: ReportStatus, note: string, actor: string): Promise<Cluster> {
  const updated = { ...c, status, updated_at: now() };
  await store.updateCluster(updated);
  for (const r of await store.listReports({ clusterId: c.id })) {
    if (r.status === "verified" || r.status === "rejected") continue;
    await store.updateReport({ ...r, status });
    await store.addEvent(event(r.id, status, note, actor));
  }
  return updated;
}

export async function decideCluster(c: Cluster, d: { decision: "approve" | "edit" | "reject"; steps?: string[]; department_id?: string; sla_hours?: number; note?: string }, officer: string): Promise<Cluster> {
  if (!c.plan) throw new TransitionError("cluster has no plan");
  if (c.status !== "awaiting_approval" && c.status !== "reopened") throw new TransitionError(`cluster is ${c.status}, not awaiting approval`);
  const plan = { ...c.plan };

  if (d.decision === "edit") {
    if (d.steps) plan.steps = d.steps.map((s) => s.trim()).filter(Boolean);
    if (d.department_id) {
      const dept = departmentById(d.department_id);
      if (!dept) throw new TransitionError("unknown department");
      plan.department_id = dept.id;
      plan.department_name = dept.name;
    }
    if (d.sla_hours) plan.sla_hours = d.sla_hours;
    plan.officer_note = d.note ?? null;
    await store.savePlan(plan);
    return { ...c, plan };
  }
  if (d.decision === "reject") {
    plan.status = "rejected";
    plan.officer_note = d.note || "Rejected by officer";
    await store.savePlan(plan);
    return setClusterStatus({ ...c, plan }, "rejected", `Closed by officer: ${plan.officer_note}`, officer);
  }
  checkTransition(c.status, "assigned");
  plan.status = "approved";
  plan.officer_note = d.note ?? null;
  plan.due_at = new Date(Date.now() + plan.sla_hours * 3_600_000).toISOString();
  await store.savePlan(plan);
  return setClusterStatus({ ...c, plan }, "assigned", `Assigned to ${plan.department_name}; target ${plan.due_at}`, officer);
}

export async function updateProgress(c: Cluster, status: "in_progress" | "resolved", note: string | undefined, officer: string): Promise<Cluster> {
  checkTransition(c.status, status);
  const defaultNote = status === "in_progress" ? "Work started" : "Marked fixed — please confirm";
  return setClusterStatus(c, status, note || defaultNote, officer);
}

export async function reopenCluster(c: Cluster, note: string, actor: string): Promise<Cluster> {
  const updated = await setClusterStatus(c, "reopened", note, actor);
  if (updated.plan) {
    const plan = { ...updated.plan, status: "draft" as const };
    await store.savePlan(plan);
    return { ...updated, plan };
  }
  return updated;
}
