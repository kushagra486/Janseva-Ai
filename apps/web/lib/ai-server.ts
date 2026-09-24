import "server-only";
import { getSession } from "./session";

const AI_URL = (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class AiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Server-side call to the AI service with the caller's identity attached. */
export async function aiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const s = await getSession();
  const headers = new Headers(init.headers);
  headers.delete("authorization");
  headers.delete("x-demo-role");
  headers.delete("x-demo-user");
  if (s.demo) {
    headers.set("X-Demo-Role", s.role);
    if (s.userId) headers.set("X-Demo-User", s.userId);
  } else if (s.token) {
    headers.set("Authorization", `Bearer ${s.token}`);
  }
  return fetch(`${AI_URL}${path}`, { ...init, headers, cache: "no-store" });
}

export async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
  } catch {
    return res.statusText || `Request failed (${res.status})`;
  }
}

export async function aiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await aiFetch(path, init);
  if (!res.ok) throw new AiError(res.status, await errorMessage(res));
  return res.json() as Promise<T>;
}
