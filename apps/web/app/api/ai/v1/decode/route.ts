import { NextResponse, type NextRequest } from "next/server";
import type { DecodeResponse, Lang } from "@janseva/shared";
import { currentUser, checkOwnedPath, downloadObject } from "@/lib/ai/auth";
import { decodeBytes, decodeText } from "@/lib/ai/decode";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  const body = await req.json();
  const language: Lang = body.language ?? "hi";
  let result: DecodeResponse | NextResponse;
  if (body.text) {
    result = await decodeText(body.text, language, 1.0);
  } else if (body.file_path) {
    const denied = checkOwnedPath(user, body.file_path);
    if (denied) return denied;
    const obj = await downloadObject("janseva-notices", body.file_path);
    if (obj instanceof NextResponse) return obj;
    result = await decodeBytes(obj.data, obj.contentType, language);
  } else {
    return NextResponse.json({ detail: "Provide text or file_path" }, { status: 422 });
  }
  return result instanceof NextResponse ? result : NextResponse.json(result);
}
