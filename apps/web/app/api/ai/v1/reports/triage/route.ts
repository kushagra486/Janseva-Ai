import { NextResponse, type NextRequest } from "next/server";
import { TriageRequest, type TriageResponse } from "@janseva/shared";
import { currentUser, checkOwnedPath } from "@/lib/ai/auth";
import { runTriage } from "@/lib/ai/agents";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  const body = TriageRequest.parse(await req.json());
  if (!(body.text?.trim() || body.transcript || body.category)) {
    return NextResponse.json({ detail: "Describe the problem, record a voice note, or pick a category" }, { status: 422 });
  }
  if (body.photo_path) {
    const denied = checkOwnedPath(user, body.photo_path);
    if (denied) return denied;
  }
  const result = await runTriage(body, user.id);
  return NextResponse.json({
    report: result.report, cluster: result.cluster, merged: result.merged,
    similarity: result.similarity, timeline: result.timeline,
  } satisfies TriageResponse);
}
