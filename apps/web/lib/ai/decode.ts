import "server-only";
import { NextResponse } from "next/server";
import type { Citation, DecodeResponse, Lang } from "@janseva/shared";
import { LLMUnavailable, visionReadNotice } from "@/lib/ai/groq";
import { llmExtract, merge, rulesExtract } from "@/lib/ai/extract";
import { templateExplain, llmExplain, DISCLAIMER } from "@/lib/ai/explain";
import { maskPii } from "@/lib/ai/pii";
import { rerank, search } from "@/lib/ai/retriever";

const MAX_BYTES = 10 * 1024 * 1024;
const LOW_CONFIDENCE = 0.7;
const TYPE_QUERY: Record<string, string> = {
  property_tax: "pay property house tax lucknow nagar nigam",
  water_bill: "pay water tax bill jal kal lucknow",
  electricity_bill: "pay electricity bill uppcl",
  traffic_challan: "pay traffic e-challan",
  building_violation: "building map approval lda",
  encroachment: "encroachment notice nagar nigam",
};

export async function decodeText(rawText: string, language: Lang, ocrQuality: number): Promise<DecodeResponse | NextResponse> {
  if (rawText.trim().length < 15) {
    return NextResponse.json({ detail: "Could not read enough text. Retake the photo in good light, flat, with the whole notice in frame." }, { status: 422 });
  }
  const { masked } = maskPii(rawText);
  const rules = rulesExtract(masked);
  const llm = await llmExtract(masked);
  const fields = merge(rules, llm);
  const provider = llm ? "groq" : "rules";

  const query = TYPE_QUERY[String(fields.notice_type.value ?? "")] ?? masked.slice(0, 300);
  const hits = rerank(search(query, 6));
  const guide = hits.map((h) => h.chunk.content).join("\n\n");
  const citations: Citation[] = hits.map((h) => ({ title: h.chunk.title, url: h.chunk.url, source_id: h.chunk.sourceId }));

  let explanation = templateExplain(fields, language);
  const better = await llmExplain(fields, guide, language, explanation);
  if (better) explanation = better;

  const keyFields = ["notice_type", "authority", "amount", "deadline"] as const;
  const confs = keyFields.map((k) => fields[k]).filter((f) => f.value !== null).map((f) => f.confidence);
  const low = keyFields.filter((k) => fields[k].value === null || fields[k].confidence < LOW_CONFIDENCE);
  const overall = confs.length ? (confs.reduce((a, b) => a + b, 0) / keyFields.length) * (0.5 + 0.5 * ocrQuality) : 0;

  return {
    ocr_text: rawText, masked_text: masked, fields, explanation,
    confidence: Math.round(overall * 100) / 100, low_confidence_fields: low,
    citations, provider, disclaimer: DISCLAIMER[language],
  };
}

export async function decodeBytes(data: ArrayBuffer, contentType: string, language: Lang): Promise<DecodeResponse | NextResponse> {
  if (data.byteLength > MAX_BYTES) return NextResponse.json({ detail: "File too large (max 10 MB)" }, { status: 413 });
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ detail: "PDF notices aren't supported in this deployment — please upload a clear photo instead." }, { status: 422 });
  }
  const base64 = Buffer.from(data).toString("base64");
  try {
    const text = await visionReadNotice(base64, contentType);
    return decodeText(text, language, 0.85);
  } catch (e) {
    if (e instanceof LLMUnavailable) {
      return NextResponse.json({ detail: "Could not read the photo right now. Please try pasting the notice text instead." }, { status: 422 });
    }
    throw e;
  }
}

