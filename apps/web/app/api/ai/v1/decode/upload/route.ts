import { NextResponse, type NextRequest } from "next/server";
import type { Lang } from "@janseva/shared";
import { LLMUnavailable, visionReadNotice } from "@/lib/ai/groq";
import { decodeText } from "@/lib/ai/decode";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const fd = await req.formData();
  const file = fd.get("file");
  const language = (fd.get("language") as Lang) ?? "hi";
  if (!(file instanceof File)) return NextResponse.json({ detail: "Provide a file" }, { status: 422 });
  const data = await file.arrayBuffer();
  if (data.byteLength > MAX_BYTES) return NextResponse.json({ detail: "File too large (max 10 MB)" }, { status: 413 });
  const contentType = file.type || "application/octet-stream";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ detail: "PDF notices aren't supported in this deployment — please upload a clear photo instead." }, { status: 422 });
  }
  try {
    const text = await visionReadNotice(Buffer.from(data).toString("base64"), contentType);
    const result = await decodeText(text, language, 0.85);
    return result instanceof NextResponse ? result : NextResponse.json(result);
  } catch (e) {
    if (e instanceof LLMUnavailable) {
      return NextResponse.json({ detail: "Could not read the photo right now. Please try pasting the notice text instead." }, { status: 422 });
    }
    throw e;
  }
}
