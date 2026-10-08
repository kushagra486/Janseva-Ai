import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/ai/auth";
import { reopenCluster } from "@/lib/ai/agents";
import * as store from "@/lib/ai/store";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const body = await req.json();
  const r = await store.getReport(id);
  if (!r) return NextResponse.json({ detail: "Report not found" }, { status: 404 });
  if (r.user_id !== user.id) return NextResponse.json({ detail: "Only the person who reported this can confirm the fix" }, { status: 403 });
  if (r.status !== "resolved") return NextResponse.json({ detail: "This report is not marked resolved yet" }, { status: 409 });

  await store.addFeedback(r.id, body.rating ?? null, Boolean(body.confirmed), body.comment ?? null);
  if (!r.cluster_id) return NextResponse.json(r);
  const c = await store.getCluster(r.cluster_id);
  if (!c) return NextResponse.json(r);

  if (body.confirmed) {
    const verified = { ...r, status: "verified" as const };
    await store.updateReport(verified);
    await store.addEvent({ id: crypto.randomUUID(), report_id: r.id, status: "verified", note: "Citizen confirmed the fix", actor: "citizen", created_at: new Date().toISOString() });
    const members = await store.listReports({ clusterId: c.id });
    if (members.every((m) => (m.id === r.id ? true : m.status === "verified"))) {
      await store.updateCluster({ ...c, status: "verified", updated_at: new Date().toISOString() });
    }
    return NextResponse.json(verified);
  }
  const note = body.comment ? `Citizen disputed the fix: ${body.comment}` : "Citizen disputed the fix";
  await reopenCluster(c, note, "feedback-agent");
  const refreshed = await store.getReport(r.id);
  return NextResponse.json(refreshed ?? r);
}
