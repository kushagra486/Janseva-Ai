// Same-origin proxy to the AI service. The browser never sees the service URL, and the
// caller's identity (Supabase token or demo role) is attached server-side.
import { type NextRequest } from "next/server";
import { aiFetch } from "@/lib/ai-server";

const ALLOWED = /^(v1\/[\w\-/]+|health)$/;

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!ALLOWED.test(joined)) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  const ctype = req.headers.get("content-type");
  if (ctype) headers.set("content-type", ctype);
  const hasBody = !["GET", "HEAD"].includes(req.method);

  let upstream: Response;
  try {
    upstream = await aiFetch(`/${joined}${req.nextUrl.search}`, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
    });
  } catch {
    return Response.json({ detail: "The AI service is not reachable right now." }, { status: 503 });
  }
  const out = new Headers();
  for (const h of ["content-type", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { handle as GET, handle as POST, handle as DELETE };
