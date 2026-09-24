// Browser-side calls to the AI service, through the same-origin /api/ai proxy.
import type { AskResponse, Citation, DecodeResponse, Lang, SchemeAnswers, SchemeMatchResponse } from "@janseva/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return parse<T>(await fetch(`/api/ai${path}`, init));
}

export const postJson = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function decodeText(text: string, language: Lang) {
  return postJson<DecodeResponse>("/v1/decode", { text, language });
}

export function decodeFilePath(file_path: string, language: Lang) {
  return postJson<DecodeResponse>("/v1/decode", { file_path, language });
}

export function decodeFile(file: File, language: Lang) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("language", language);
  return api<DecodeResponse>("/v1/decode/upload", { method: "POST", body: fd });
}

export function matchSchemes(a: SchemeAnswers) {
  return postJson<SchemeMatchResponse>("/v1/schemes/match", a);
}

export async function transcribe(audio: Blob): Promise<string> {
  const fd = new FormData();
  fd.append("file", audio, "voice.webm");
  const r = await api<{ text: string }>("/v1/stt", { method: "POST", body: fd });
  return r.text;
}

/** Streams the navigator answer. Falls back to the non-streaming response shape. */
export async function askStream(
  question: string,
  onCitations: (c: Citation[]) => void,
  onText: (piece: string) => void,
): Promise<void> {
  const res = await fetch("/api/ai/v1/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, stream: true }),
  });
  if (!res.ok || !res.body) {
    await parse<AskResponse>(res);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const event = raw.match(/^event: (.*)$/m)?.[1] ?? "message";
      const data = raw.match(/^data: (.*)$/m)?.[1];
      if (data == null) continue;
      if (event === "citations") onCitations(JSON.parse(data));
      else if (event === "message") onText(JSON.parse(data));
    }
  }
}
