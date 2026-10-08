import { NextResponse } from "next/server";
import corpus from "@/lib/ai/data/corpus.json";
import { currentUser, requireRole } from "@/lib/ai/auth";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const denied = requireRole(user, "admin");
  if (denied) return denied;
  return NextResponse.json(
    corpus.filter((c) => c.sourceId === id).map((c) => ({ id: c.id, content: c.content, ordinal: c.ordinal })),
  );
}
