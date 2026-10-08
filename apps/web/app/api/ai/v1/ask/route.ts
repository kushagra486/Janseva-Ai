import { NextResponse, type NextRequest } from "next/server";
import type { AskResponse, Citation, Lang } from "@janseva/shared";
import { chat, LLMUnavailable, streamChat } from "@/lib/ai/groq";
import { maskPii } from "@/lib/ai/pii";
import { rerank, search, type Hit } from "@/lib/ai/retriever";

const HINGLISH = /\b(kaise|kya|kahan|kitna|karein|karen|kare|hai|hota|milega|chahiye|banwana|banega|mera|meri|apna|kab)\b/i;

const SYSTEM = `You are JANSEVA, a helpful guide to government services in Lucknow and Uttar Pradesh.
Answer ONLY from the CONTEXT. If the context does not contain the answer, say you don't know
and suggest the office to contact. Give short numbered steps, the documents needed, fees and
time if the context has them, and the official link. Cite sources inline as [1], [2] matching
the context numbers. Reply in {lang_hint}. Keep it under 180 words.`;

const NO_ANSWER: Record<Lang, string> = {
  hi: "माफ़ कीजिए, इस सवाल की पक्की जानकारी हमारे पास नहीं है। कृपया नगर निगम लखनऊ के हेल्पलाइन या नज़दीकी जन सेवा केंद्र (CSC) से संपर्क करें।",
  en: "Sorry, I don't have verified information on that yet. Please contact the Lucknow Nagar Nigam helpline or your nearest Jan Seva Kendra (CSC).",
};

function detect(question: string): [Lang, string] {
  const dev = [...question].filter((ch) => ch >= "ऀ" && ch <= "ॿ").length;
  if (dev > 2) return ["hi", "simple Hindi in Devanagari script"];
  if (HINGLISH.test(question)) return ["hi", "simple Hinglish (Hindi written in Roman script), like the question"];
  return ["en", "simple English"];
}

function contextBlock(hits: Hit[]): string {
  return hits.map((h, i) => `[${i + 1}] ${h.chunk.title} (${h.chunk.url ?? "no link"})\n${h.chunk.content}`).join("\n\n");
}

function extractiveAnswer(hits: Hit[], lang: Lang): string {
  const top = hits[0].chunk;
  const head = lang === "hi" ? "यह जानकारी आधिकारिक गाइड से है:" : "From the official guide:";
  const body = top.content.split("\n").slice(1).join("\n").trim();
  const link = top.url ? `\n\n${top.url}` : "";
  return `${head} [1]\n\n${body}${link}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { masked } = maskPii(String(body.question ?? ""));
  let [lang, hint] = detect(masked);
  if (body.language) {
    lang = body.language;
    hint = lang === "hi" ? "simple Hindi in Devanagari script" : "simple English";
  }
  const hits = rerank(search(masked, 8), 3);
  const citations: Citation[] = hits.map((h) => ({ title: h.chunk.title, url: h.chunk.url, source_id: h.chunk.sourceId }));
  const messages = [
    { role: "system" as const, content: SYSTEM.replace("{lang_hint}", hint) },
    { role: "user" as const, content: `CONTEXT:\n${contextBlock(hits)}\n\nQUESTION: ${masked}` },
  ];

  if (body.stream) {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`event: citations\ndata: ${JSON.stringify(citations)}\n\n`));
        if (!hits.length) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(NO_ANSWER[lang])}\n\n`));
        } else {
          try {
            for await (const piece of streamChat(messages)) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(piece)}\n\n`));
            }
          } catch (e) {
            if (e instanceof LLMUnavailable) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(extractiveAnswer(hits, lang))}\n\n`));
            } else {
              controller.error(e);
              return;
            }
          }
        }
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        controller.close();
      },
    });
    return new Response(streamBody, { headers: { "content-type": "text/event-stream" } });
  }

  if (!hits.length) {
    return NextResponse.json({ answer: NO_ANSWER[lang], citations: [], language: lang, provider: "rules" } satisfies AskResponse);
  }
  let answer: string, provider: string;
  try {
    answer = (await chat(messages)).trim();
    provider = "groq";
  } catch (e) {
    if (!(e instanceof LLMUnavailable)) throw e;
    answer = extractiveAnswer(hits, lang);
    provider = "rules";
  }
  return NextResponse.json({ answer, citations, language: lang, provider } satisfies AskResponse);
}
