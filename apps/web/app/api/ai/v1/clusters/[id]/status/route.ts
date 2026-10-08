import { NextResponse, type NextRequest } from "next/server";
import { currentUser, requireRole } from "@/lib/ai/auth";
import { updateProgress, TransitionError } from "@/lib/ai/agents";
import * as store from "@/lib/ai/store";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const denied = requireRole(user, "officer", "admin");
  if (denied) return denied;
  const c = await store.getCluster(id);
  if (!c) return NextResponse.json({ detail: "Issue not found" }, { status: 404 });
  const body = await req.json();
  try {
    return NextResponse.json(await updateProgress(c, body.status, body.note, `officer:${user.id}`));
  } catch (e) {
    if (e instanceof TransitionError) return NextResponse.json({ detail: e.message }, { status: 409 });
    throw e;
  }
}
