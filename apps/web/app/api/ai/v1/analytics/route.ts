import { NextResponse } from "next/server";
import type { Analytics } from "@janseva/shared";
import { currentUser, requireRole } from "@/lib/ai/auth";
import * as store from "@/lib/ai/store";

export async function GET() {
  const user = await currentUser();
  const denied = requireRole(user, "officer", "admin");
  if (denied) return denied;
  const cs = await store.listClusters({ ward: user.role === "officer" ? (user.ward ?? undefined) : undefined });
  const byCat: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const c of cs) {
    byCat[c.category] = (byCat[c.category] ?? 0) + 1;
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }
  const durations: number[] = [];
  let breaches = 0;
  const t = Date.now();
  for (const c of cs) {
    if ((c.status === "resolved" || c.status === "verified") && c.plan) {
      durations.push((new Date(c.updated_at).getTime() - new Date(c.plan.created_at).getTime()) / 3_600_000);
    }
    if (c.plan?.due_at && (c.status === "assigned" || c.status === "in_progress") && new Date(c.plan.due_at).getTime() < t) {
      breaches += 1;
    }
  }
  const { satisfaction, disputes, total } = await store.feedbackStats();
  return NextResponse.json({
    by_category: byCat, by_status: byStatus,
    avg_resolution_hours: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null,
    reopen_rate: total ? Math.round((disputes / total) * 100) / 100 : 0,
    satisfaction: satisfaction !== null ? Math.round(satisfaction * 100) / 100 : null,
    sla_breaches: breaches,
  } satisfies Analytics);
}
