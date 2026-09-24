"""Push the curated corpus in data/ into Supabase.

  * Every data/services/*.md is sent to the AI service's /v1/admin/ingest, which chunks,
    embeds and writes sources + doc_chunks.
  * data/schemes/*.json is upserted into the schemes table.

Usage:
  AI_SERVICE_URL=https://... ADMIN_TOKEN=<an admin's Supabase access token> \
  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_KEY=... \
  python scripts/sync_corpus.py
"""

import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "ai-service"))
from app.pipelines.ingest import parse_frontmatter  # noqa: E402


def main() -> None:
    ai = os.environ["AI_SERVICE_URL"].rstrip("/")
    token = os.environ["ADMIN_TOKEN"]
    sb = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = os.environ["SUPABASE_SERVICE_KEY"]
    sb_headers = {"apikey": key, "Authorization": f"Bearer {key}",
                  "Content-Type": "application/json",
                  "Prefer": "resolution=merge-duplicates,return=minimal"}

    with httpx.Client(timeout=60) as client:
        for f in sorted((ROOT / "data" / "services").glob("*.md")):
            meta, body = parse_frontmatter(f.read_text("utf-8"))
            r = client.post(f"{ai}/v1/admin/ingest", headers={"Authorization": f"Bearer {token}"},
                            json={"title": meta.get("title", f.stem), "content": body,
                                  "url": meta.get("source_url"), "kind": "service"})
            r.raise_for_status()
            print(f"ingested {f.name}: {len(r.json()['chunks'])} chunks")

        schemes = []
        for f in sorted((ROOT / "data" / "schemes").glob("*.json")):
            schemes += json.loads(f.read_text("utf-8"))
        rows = [{"id": s["id"], "name": s["name"], "name_hi": s.get("name_hi"),
                 "level": s.get("level"), "rules": s.get("rules", {}),
                 "documents": s.get("documents", []), "apply_url": s.get("apply_url")}
                for s in schemes]
        r = client.post(f"{sb}/schemes", params={"on_conflict": "id"}, headers=sb_headers,
                        json=rows)
        r.raise_for_status()
        print(f"upserted {len(rows)} schemes")


if __name__ == "__main__":
    main()
