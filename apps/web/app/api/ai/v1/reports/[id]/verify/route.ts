import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/ai/auth";
import * as store from "@/lib/ai/store";

// The original ai-service ran a perceptual-hash before/after photo diff here (a lightweight,
// advisory check — never load-bearing, per its own docstring). That needs native image
// decoding, which isn't available on Workers. Dropped: this now just records the event and
// returns "uncertain", same as the original did for a small/ambiguous visual change — the
// citizen's own confirmation (the /feedback endpoint) remains the real mechanism either way.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await currentUser();
  const r = await store.getReport(id);
  if (!r) return NextResponse.json({ detail: "Report not found" }, { status: 404 });
  if (r.user_id !== user.id && user.role === "citizen") {
    return NextResponse.json({ detail: "Only the person who reported this can verify it" }, { status: 403 });
  }
  if (r.status !== "resolved") return NextResponse.json({ detail: "This report is not marked resolved yet" }, { status: 409 });
  const note = "Automatic photo comparison isn't available in this deployment — please confirm below.";
  await store.addEvent({ id: crypto.randomUUID(), report_id: r.id, status: "resolved", note: `Verifier: ${note}`, actor: "verifier-agent", created_at: new Date().toISOString() });
  return NextResponse.json({ verdict: "uncertain", change_score: 0, report: r, note });
}
