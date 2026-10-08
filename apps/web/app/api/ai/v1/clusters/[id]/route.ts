import { NextResponse } from "next/server";
import { currentUser, requireRole } from "@/lib/ai/auth";
import * as store from "@/lib/ai/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const denied = requireRole(user, "officer", "admin");
  if (denied) return denied;
  const c = await store.getCluster(id);
  if (!c) return NextResponse.json({ detail: "Issue not found" }, { status: 404 });
  return NextResponse.json({ cluster: c, reports: await store.listReports({ clusterId: id }) });
}
