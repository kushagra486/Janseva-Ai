import { NextResponse } from "next/server";
import { currentUser } from "@/lib/ai/auth";
import * as store from "@/lib/ai/store";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json(await store.listReports({ userId: user.id ?? undefined }));
}
