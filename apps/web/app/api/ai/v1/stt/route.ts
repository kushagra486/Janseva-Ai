import { NextResponse, type NextRequest } from "next/server";
import { LLMUnavailable, transcribe } from "@/lib/ai/groq";

export async function POST(req: NextRequest) {
  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return NextResponse.json({ detail: "Provide a file" }, { status: 422 });
  try {
    const { text, language } = await transcribe(file, file.name || "voice.webm");
    return NextResponse.json({ text, language, provider: "groq" });
  } catch (e) {
    if (e instanceof LLMUnavailable) return NextResponse.json({ detail: "Speech-to-text is not available right now." }, { status: 503 });
    throw e;
  }
}
