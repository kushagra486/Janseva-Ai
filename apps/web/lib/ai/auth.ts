// Identity for AI route handlers. The original ai-service verified a forwarded Supabase JWT
// itself (deps.py); since these routes now run inside the same Next.js app, they can just read
// the already-verified session cookie via getSession() — no JWT re-verification needed.
import "server-only";
import { NextResponse } from "next/server";
import { getSession, type Role } from "../session";
import { SUPABASE_URL } from "../env";

export type AuthUser = { id: string | null; role: Role; ward: string | null };

export async function currentUser(): Promise<AuthUser> {
  const s = await getSession();
  return { id: s.userId, role: s.role, ward: null };
}

export function requireRole(user: AuthUser, ...roles: Role[]): NextResponse | null {
  if (!roles.includes(user.role)) {
    return NextResponse.json({ detail: `Requires role: ${roles.join(", ")}` }, { status: 403 });
  }
  return null;
}

export function checkOwnedPath(user: AuthUser, path: string): NextResponse | null {
  if (user.role === "citizen" && !path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ detail: "Not your file" }, { status: 403 });
  }
  return null;
}

export async function downloadObject(bucket: string, path: string): Promise<{ data: ArrayBuffer; contentType: string } | NextResponse> {
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!SUPABASE_URL || !key) {
    return NextResponse.json({ detail: "file_path needs Supabase; upload the file directly instead" }, { status: 400 });
  }
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
  if (res.status === 404) return NextResponse.json({ detail: "File not found in storage" }, { status: 404 });
  if (!res.ok) return NextResponse.json({ detail: `Storage error (${res.status})` }, { status: 502 });
  return { data: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}
