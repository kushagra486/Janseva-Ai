import { NextResponse } from "next/server";
import corpus from "@/lib/ai/data/corpus.json";
import { groqConfigured } from "@/lib/ai/groq";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    providers: { groq: groqConfigured() },
    store: "supabase",
    embed_provider: "none (keyword retrieval only)",
    corpus_chunks: corpus.length,
    version: "serverless-1",
  });
}
