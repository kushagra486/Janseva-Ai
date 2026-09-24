"use server";
// Server actions: writes that go straight to Supabase, or through the AI service where an
// agent is involved. Each one re-checks who the caller is.
import type { Cluster, DecodeResponse, PlanDecision, TriageRequest, TriageResponse } from "@janseva/shared";
import { Deadline, PlanDecision as PlanDecisionSchema, TriageRequest as TriageSchema } from "@janseva/shared";
import { cookies } from "next/headers";
import { AiError, aiJson } from "@/lib/ai-server";
import { DEMO_ROLE_COOKIE, getSession, type Role } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase/server";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const msg = e instanceof AiError ? e.message : e instanceof Error ? e.message : "Unexpected error";
    return { ok: false, error: msg };
  }
}

export async function setDemoRole(role: Role): Promise<void> {
  const s = await getSession();
  if (!s.demo) return;
  (await cookies()).set(DEMO_ROLE_COOKIE, role, { sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export async function createReport(input: TriageRequest): Promise<Result<TriageResponse>> {
  return run(async () => {
    const body = TriageSchema.parse(input);
    return aiJson<TriageResponse>("/v1/reports/triage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  });
}

export async function decidePlan(clusterId: string, decision: PlanDecision): Promise<Result<Cluster>> {
  return run(async () => {
    const body = PlanDecisionSchema.parse(decision);
    return aiJson<Cluster>(`/v1/clusters/${encodeURIComponent(clusterId)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  });
}

export async function updateClusterStatus(
  clusterId: string,
  status: "in_progress" | "resolved",
  note?: string,
): Promise<Result<Cluster>> {
  return run(() =>
    aiJson<Cluster>(`/v1/clusters/${encodeURIComponent(clusterId)}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, note }),
    }),
  );
}

/**
 * Saves a deadline (and the decoded notice) to Supabase when signed in, so the reminder Edge
 * Function can send push and email. Signed out, returns "local" and the browser keeps it.
 */
export async function saveDeadline(
  deadline: Deadline,
  decoded?: DecodeResponse,
  imagePath?: string,
): Promise<Result<"server" | "local">> {
  return run(async () => {
    const d = Deadline.parse(deadline);
    const s = await getSession();
    const supabase = await getServerSupabase();
    if (!supabase || !s.userId) return "local" as const;
    let noticeId: string | null = null;
    if (decoded) {
      const { data, error } = await supabase
        .from("notices")
        .insert({
          image_path: imagePath ?? null,
          ocr_text: decoded.masked_text,
          fields: decoded.fields,
          explanation: decoded.explanation,
          confidence: decoded.confidence,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      noticeId = data.id;
    }
    const { error } = await supabase
      .from("deadlines")
      .insert({ id: d.id, notice_id: noticeId, title: d.title, due_date: d.due_date });
    if (error) throw new Error(error.message);
    return "server" as const;
  });
}

export async function acceptConsent(): Promise<void> {
  const supabase = await getServerSupabase();
  const s = await getSession();
  if (supabase && s.userId) {
    await supabase.from("profiles").update({ consent_at: new Date().toISOString() }).eq("id", s.userId);
  }
}

export async function setDeadlineStatus(id: string, status: "done" | "dismissed"): Promise<Result<null>> {
  return run(async () => {
    const supabase = await getServerSupabase();
    const s = await getSession();
    if (supabase && s.userId) {
      const { error } = await supabase.from("deadlines").update({ status }).eq("id", id);
      if (error) throw new Error(error.message);
    }
    return null;
  });
}
