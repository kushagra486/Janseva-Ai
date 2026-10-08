import { NextResponse } from "next/server";
import { currentUser, requireRole } from "@/lib/ai/auth";

export async function DELETE() {
  const user = await currentUser();
  const denied = requireRole(user, "admin");
  if (denied) return denied;
  return NextResponse.json(
    { detail: "The knowledge corpus is static in this deployment — edit data/services/*.md and redeploy to change it." },
    { status: 501 },
  );
}
