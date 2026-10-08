import { NextResponse } from "next/server";
import { currentUser, requireRole } from "@/lib/ai/auth";
import * as store from "@/lib/ai/store";

export async function GET() {
  const user = await currentUser();
  const denied = requireRole(user, "officer", "admin");
  if (denied) return denied;
  return NextResponse.json(await store.listClusters({ ward: user.role === "officer" ? (user.ward ?? undefined) : undefined }));
}
