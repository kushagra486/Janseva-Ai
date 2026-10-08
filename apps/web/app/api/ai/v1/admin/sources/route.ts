import { NextResponse } from "next/server";
import corpus from "@/lib/ai/data/corpus.json";
import { currentUser, requireRole } from "@/lib/ai/auth";

// The corpus is now static (bundled at deploy time from data/services/*.md) rather than
// dynamically ingestable, since there is no runtime store for it to live in on Workers. This
// read-only listing still works; the write endpoints below explain the change instead of
// silently failing.
export async function GET() {
  const user = await currentUser();
  const denied = requireRole(user, "admin");
  if (denied) return denied;
  const bySource = new Map<string, { id: string; title: string; url: string | null; chunks: number }>();
  for (const c of corpus) {
    const s = bySource.get(c.sourceId);
    if (s) s.chunks += 1;
    else bySource.set(c.sourceId, { id: c.sourceId, title: c.title, url: c.url, chunks: 1 });
  }
  return NextResponse.json([...bySource.values()]);
}
