import { NextResponse } from "next/server";
import { currentUser } from "@/lib/ai/auth";
import * as store from "@/lib/ai/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const r = await store.getReport(id);
  if (!r) return NextResponse.json({ detail: "Report not found" }, { status: 404 });
  const c = r.cluster_id ? await store.getCluster(r.cluster_id) : null;
  const isOwner = user.id === r.user_id || user.role === "officer" || user.role === "admin";
  return NextResponse.json({
    report: isOwner ? r : null,
    cluster: c,
    timeline: await store.listEvents(id),
  });
}
