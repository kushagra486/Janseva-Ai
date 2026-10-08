import { NextResponse } from "next/server";
import { departments } from "@/lib/ai/agents";

export async function GET() {
  return NextResponse.json(departments());
}
