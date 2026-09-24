// API contracts shared by the web app and the AI service.
// Mirrors apps/ai-service/app/schemas.py — keep both in sync (contract.test.ts checks the
// enums against the Python file).
import { z } from "zod";

export const Lang = z.enum(["hi", "en"]);
export type Lang = z.infer<typeof Lang>;

export const CATEGORIES = ["waste", "water_drainage", "roads", "streetlights", "public_infra"] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

export const REPORT_STATUSES = [
  "submitted", "triaged", "clustered", "planned", "awaiting_approval", "assigned",
  "in_progress", "resolved", "verified", "reopened", "rejected",
] as const;
export const ReportStatus = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof ReportStatus>;

// ---------- Notice decoder ----------

export const FieldValue = z.object({
  value: z.union([z.string(), z.number()]).nullable(),
  confidence: z.number().min(0).max(1),
});
export type FieldValue = z.infer<typeof FieldValue>;

export const NOTICE_FIELDS = ["notice_type", "authority", "amount", "deadline", "penalty", "reference", "period"] as const;
export const NoticeFields = z.object(
  Object.fromEntries(NOTICE_FIELDS.map((k) => [k, FieldValue])) as Record<(typeof NOTICE_FIELDS)[number], typeof FieldValue>,
);
export type NoticeFields = z.infer<typeof NoticeFields>;

export const Citation = z.object({
  title: z.string(),
  url: z.string().nullable(),
  source_id: z.string(),
});
export type Citation = z.infer<typeof Citation>;

export const Explanation = z.object({
  what_it_is: z.string(),
  what_you_owe: z.string().nullable(),
  deadline: z.string().nullable(),
  if_you_miss_it: z.string().nullable(),
  do_this_now: z.array(z.string()),
});
export type Explanation = z.infer<typeof Explanation>;

export const DecodeRequest = z.object({
  text: z.string().optional(),
  file_path: z.string().optional(),
  language: Lang,
});
export type DecodeRequest = z.infer<typeof DecodeRequest>;

export const DecodeResponse = z.object({
  ocr_text: z.string(),
  masked_text: z.string(),
  fields: NoticeFields,
  explanation: Explanation,
  confidence: z.number(),
  low_confidence_fields: z.array(z.string()),
  citations: z.array(Citation),
  provider: z.string(),
  disclaimer: z.string(),
});
export type DecodeResponse = z.infer<typeof DecodeResponse>;

// ---------- Service navigator ----------

export const AskRequest = z.object({
  question: z.string().min(2).max(1000),
  language: Lang.optional(),
  stream: z.boolean().optional(),
});
export type AskRequest = z.infer<typeof AskRequest>;

export const AskResponse = z.object({
  answer: z.string(),
  citations: z.array(Citation),
  language: Lang,
  provider: z.string(),
});
export type AskResponse = z.infer<typeof AskResponse>;

// ---------- Scheme finder ----------

export const INCOME_BANDS = ["below_50k", "50k_1l", "1l_2_5l", "2_5l_5l", "5l_8l", "above_8l"] as const;
export const OCCUPATIONS = [
  "farmer", "street_vendor", "daily_wage", "salaried", "self_employed", "student",
  "homemaker", "artisan", "unemployed", "retired",
] as const;
export const SOCIAL_CATEGORIES = ["general", "obc", "sc", "st", "ews"] as const;
export const GENDERS = ["female", "male", "other"] as const;

export const SchemeAnswers = z.object({
  age: z.number().int().min(0).max(120),
  gender: z.enum(GENDERS),
  income_band: z.enum(INCOME_BANDS),
  occupation: z.enum(OCCUPATIONS),
  category: z.enum(SOCIAL_CATEGORIES),
  district: z.string().min(2),
  widowed: z.boolean().default(false),
  disability: z.boolean().default(false),
  language: Lang,
});
export type SchemeAnswers = z.infer<typeof SchemeAnswers>;

export const SchemeMatch = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["eligible", "needs_check"]),
  reasons: z.array(z.string()),
  checks: z.array(z.string()),
  benefit: z.string(),
  documents: z.array(z.string()),
  apply_url: z.string().nullable(),
  source_url: z.string().nullable(),
  explanation: z.string(),
});
export type SchemeMatch = z.infer<typeof SchemeMatch>;

export const SchemeMatchResponse = z.object({
  matches: z.array(SchemeMatch),
  evaluated: z.number(),
  provider: z.string(),
});
export type SchemeMatchResponse = z.infer<typeof SchemeMatchResponse>;

// ---------- Reports ----------

export const Location = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().nullable().optional(),
});
export type Location = z.infer<typeof Location>;

export const TriageRequest = z.object({
  text: z.string().max(4000).default(""),
  category: Category.nullable().optional(),
  location: Location,
  photo_path: z.string().nullable().optional(),
  has_photo: z.boolean().default(false),
  transcript: z.string().nullable().optional(),
  ward: z.string().nullable().optional(),
});
export type TriageRequest = z.input<typeof TriageRequest>;

export const ReportEvent = z.object({
  id: z.string(),
  report_id: z.string(),
  status: ReportStatus,
  note: z.string(),
  actor: z.string(),
  created_at: z.string(),
});
export type ReportEvent = z.infer<typeof ReportEvent>;

export const Report = z.object({
  id: z.string(),
  user_id: z.string().nullable(),
  text: z.string(),
  category: Category,
  severity: z.number().int(),
  location: Location,
  ward: z.string().nullable(),
  status: ReportStatus,
  cluster_id: z.string().nullable(),
  photo_path: z.string().nullable().optional(),
  language: Lang,
  flags: z.array(z.string()),
  created_at: z.string(),
});
export type Report = z.infer<typeof Report>;

export const ActionPlan = z.object({
  id: z.string(),
  cluster_id: z.string(),
  department_id: z.string(),
  department_name: z.string(),
  steps: z.array(z.string()),
  sla_hours: z.number().int(),
  due_at: z.string().nullable(),
  status: z.enum(["draft", "approved", "rejected"]),
  officer_note: z.string().nullable(),
  drafted_by: z.string(),
  created_at: z.string(),
});
export type ActionPlan = z.infer<typeof ActionPlan>;

export const Cluster = z.object({
  id: z.string(),
  category: Category,
  title: z.string(),
  centroid: Location,
  ward: z.string().nullable(),
  report_count: z.number().int(),
  severity: z.number().int(),
  priority: z.number(),
  status: ReportStatus,
  plan: ActionPlan.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Cluster = z.infer<typeof Cluster>;

export const TriageResponse = z.object({
  report: Report,
  cluster: Cluster,
  merged: z.boolean(),
  similarity: z.number().nullable(),
  timeline: z.array(ReportEvent),
});
export type TriageResponse = z.infer<typeof TriageResponse>;

export const PlanDecision = z.object({
  decision: z.enum(["approve", "edit", "reject"]),
  steps: z.array(z.string()).optional(),
  department_id: z.string().optional(),
  sla_hours: z.number().int().min(1).max(24 * 60).optional(),
  note: z.string().optional(),
});
export type PlanDecision = z.infer<typeof PlanDecision>;

export const Analytics = z.object({
  by_category: z.record(z.string(), z.number()),
  by_status: z.record(z.string(), z.number()),
  avg_resolution_hours: z.number().nullable(),
  reopen_rate: z.number(),
  satisfaction: z.number().nullable(),
  sla_breaches: z.number(),
});
export type Analytics = z.infer<typeof Analytics>;

export const Health = z.object({
  status: z.enum(["ok", "degraded"]),
  providers: z.record(z.string(), z.boolean()),
  store: z.string(),
  embed_provider: z.string(),
  corpus_chunks: z.number(),
  version: z.string(),
});
export type Health = z.infer<typeof Health>;

// ---------- Deadlines (saved in Supabase or, signed out, in the browser) ----------

export const REMINDER_DAYS = [7, 2, 0] as const;

export const Deadline = z.object({
  id: z.string(),
  title: z.string().min(1),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notice_summary: z.string().optional(),
  amount: z.number().nullable().optional(),
  status: z.enum(["active", "done", "dismissed"]).default("active"),
});
export type Deadline = z.infer<typeof Deadline>;

/** Dates (YYYY-MM-DD) on which reminders fire for a due date, skipping ones in the past. */
export function reminderDates(dueDate: string, today: string): string[] {
  const due = Date.parse(dueDate + "T00:00:00Z");
  return REMINDER_DAYS.map((d) => new Date(due - d * 86_400_000).toISOString().slice(0, 10))
    .filter((d) => d >= today);
}
