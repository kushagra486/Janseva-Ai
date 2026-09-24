"use client";
import { ExternalLink, RefreshCw, Trash, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, ErrorBox, inputClass, Label, Spinner } from "@/components/ui";
import { api, postJson } from "@/lib/ai-client";

type Source = { id: string; title: string; url: string | null; chunks: number };
type Chunk = { id: string; content: string; ordinal: number };

export function KnowledgeConsole() {
  const t = useTranslations("knowledge");
  const c = useTranslations("common");
  const [sources, setSources] = useState<Source[] | null>(null);
  const [open, setOpen] = useState<{ id: string; chunks: Chunk[] } | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Source[]>("/v1/admin/sources").then(setSources).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  async function wrap(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : c("error"));
    } finally {
      setBusy(false);
    }
  }

  async function ingest() {
    await wrap(async () => {
      let res: { source_id: string; chunks: Chunk[] };
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("title", title);
        if (url) fd.append("url", url);
        res = await api("/v1/admin/ingest/file", { method: "POST", body: fd });
      } else {
        res = await postJson("/v1/admin/ingest", { title, content, url: url || null });
      }
      setOpen({ id: res.source_id, chunks: res.chunks });
      setTitle("");
      setUrl("");
      setContent("");
      setFile(null);
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="font-semibold">{t("addSource")}</h2>
        <div>
          <Label htmlFor="k-title">{t("sourceTitle")}</Label>
          <input id="k-title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>
        <div>
          <Label htmlFor="k-url">{t("sourceUrl")}</Label>
          <input id="k-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={inputClass} />
        </div>
        <div>
          <Label htmlFor="k-content">{t("content")}</Label>
          <textarea id="k-content" rows={8} value={content} onChange={(e) => setContent(e.target.value)} className={`${inputClass} font-mono text-sm`} />
        </div>
        <div>
          <Label htmlFor="k-file">{t("file")}</Label>
          <input id="k-file" type="file" accept="application/pdf,text/plain,text/markdown,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={inputClass} />
        </div>
        <Button onClick={ingest} disabled={busy || !title.trim() || (!file && content.trim().length < 20)}>
          <Upload className="size-5" /> {t("ingest")}
        </Button>
        {error && <ErrorBox>{error}</ErrorBox>}
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("sources")}</h2>
          <Button variant="secondary" disabled={busy} onClick={() => wrap(() => postJson("/v1/admin/reindex", {}))}>
            <RefreshCw className="size-4" /> {t("reindex")}
          </Button>
        </div>
        {busy && <Spinner label={c("loading")} />}
        {!sources ? (
          <Spinner />
        ) : (
          <ul className="space-y-2">
            {sources.map((s) => (
              <li key={s.id}>
                <Card className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{s.title}</p>
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-saffron">
                          {s.url} <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                    <Badge>{t("chunks", { count: s.chunks })}</Badge>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="ghost"
                      className="min-h-9 text-sm"
                      onClick={async () =>
                        setOpen(open?.id === s.id ? null : { id: s.id, chunks: await api<Chunk[]>(`/v1/admin/sources/${s.id}/chunks`) })
                      }
                    >
                      {t("view")}
                    </Button>
                    <Button variant="ghost" className="min-h-9 text-sm text-danger" onClick={() => wrap(() => api(`/v1/admin/sources/${s.id}`, { method: "DELETE" }))}>
                      <Trash className="size-4" /> {t("delete")}
                    </Button>
                  </div>
                  {open?.id === s.id && (
                    <ol className="mt-2 space-y-2">
                      {open.chunks.map((ch) => (
                        <li key={ch.id} className="rounded-lg bg-surface-2 p-2 text-xs">
                          <span className="text-muted">#{ch.ordinal}</span>
                          <pre className="whitespace-pre-wrap font-sans">{ch.content}</pre>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
