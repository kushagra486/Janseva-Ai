// Groq client: one entry point for every model call, ported from apps/ai-service's
// llm/gateway.py + llm/groq.py. No Ollama fallback here (Workers can't reach a local
// Ollama instance) — Groq unreachable or unset means every pipeline falls back to its
// deterministic rules path, same contract as before.
import "server-only";

const GROQ_BASE = "https://api.groq.com/openai/v1";

export class LLMUnavailable extends Error {}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

function apiKey(): string {
  return process.env.GROQ_API_KEY ?? "";
}

export async function chat(messages: ChatMessage[], opts: { temperature?: number; model?: string } = {}): Promise<string> {
  const key = apiKey();
  if (!key) throw new LLMUnavailable("GROQ_API_KEY not set");
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      messages,
      temperature: opts.temperature ?? 0.2,
    }),
  });
  if (!res.ok) throw new LLMUnavailable(`groq: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LLMUnavailable("groq: no content in response");
  return content;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1];
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model output");
  const obj = JSON.parse(s.slice(start, end + 1));
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) throw new Error("model output is not a JSON object");
  return obj;
}

export async function chatJson(messages: ChatMessage[]): Promise<Record<string, unknown>> {
  const key = apiKey();
  if (!key) throw new LLMUnavailable("GROQ_API_KEY not set");
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      messages,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new LLMUnavailable(`groq: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LLMUnavailable("groq: no content in response");
  try {
    return parseJsonObject(content);
  } catch (e) {
    throw new LLMUnavailable(`groq: invalid JSON (${(e as Error).message})`);
  }
}

/** Raw SSE passthrough from Groq's streaming endpoint; yields text deltas only. */
export async function* streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
  const key = apiKey();
  if (!key) throw new LLMUnavailable("GROQ_API_KEY not set");
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      messages,
      temperature: 0.2,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) throw new LLMUnavailable(`groq stream: ${res.status} ${await res.text().catch(() => "")}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      try {
        const delta = JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield delta;
      } catch {
        /* ignore malformed keep-alive chunks */
      }
    }
  }
}

export async function transcribe(audio: Blob, filename: string): Promise<{ text: string; language: string | null }> {
  const key = apiKey();
  if (!key) throw new LLMUnavailable("GROQ_API_KEY not set");
  const fd = new FormData();
  fd.append("file", audio, filename);
  fd.append("model", process.env.GROQ_STT_MODEL ?? "whisper-large-v3");
  fd.append("response_format", "verbose_json");
  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });
  if (!res.ok) throw new LLMUnavailable(`groq stt: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { text: (data.text ?? "").trim(), language: data.language ?? null };
}

/** Vision fallback for photographed notices: Groq reads the image directly (no local OCR on
 *  Workers). This sends the image bytes to a hosted model — a privacy trade-off the original
 *  service treated as opt-in; it is the only path available here. */
export async function visionReadNotice(base64: string, mimeType: string): Promise<string> {
  const key = apiKey();
  if (!key) throw new LLMUnavailable("GROQ_API_KEY not set");
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe every line of text visible in this photo of an Indian government "
                + "notice or bill, exactly as written (Hindi and/or English). Output plain text only, "
                + "no commentary, no markdown.",
            },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new LLMUnavailable(`groq vision: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LLMUnavailable("groq vision: no content in response");
  return content;
}

export function groqConfigured(): boolean {
  return Boolean(apiKey());
}
