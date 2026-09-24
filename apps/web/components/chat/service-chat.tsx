"use client";
import type { Citation } from "@janseva/shared";
import { ExternalLink, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { VoiceRecorder } from "@/components/voice-recorder";
import { Button, Card, ErrorBox, inputClass, Spinner } from "@/components/ui";
import { askStream } from "@/lib/ai-client";

type Msg = { role: "user" | "assistant"; text: string; citations?: Citation[] };

/** Renders [1]-style citation markers as superscripts linked to the source list. */
function withCitations(text: string, citations: Citation[] = []) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    const c = m && citations[Number(m[1]) - 1];
    if (!m) return <span key={i}>{part}</span>;
    return c?.url ? (
      <a key={i} href={c.url} target="_blank" rel="noreferrer" className="align-super text-xs text-saffron">
        {part}
      </a>
    ) : (
      <sup key={i} className="text-xs text-muted">{part}</sup>
    );
  });
}

export function ServiceChat({ initialQuestion }: { initialQuestion?: string }) {
  const t = useTranslations("services");
  const c = useTranslations("common");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setQ("");
    setError(null);
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: question }, { role: "assistant", text: "" }]);
    const patchLast = (fn: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
    try {
      await askStream(
        question,
        (citations) => patchLast((m) => ({ ...m, citations })),
        (piece) => patchLast((m) => ({ ...m, text: m.text + piece })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : c("error"));
      setMsgs((all) => all.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for ?q=
  }, [initialQuestion]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs]);

  const suggestions = t.raw("suggestions") as string[];

  return (
    <div className="space-y-4">
      {msgs.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} className="min-h-11 rounded-full border border-line bg-surface px-4 text-sm hover:border-saffron">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3" aria-live="polite">
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-saffron px-4 py-2 text-saffron-ink">
              {m.text}
            </p>
          ) : (
            <Card key={i} className="max-w-[95%]">
              {m.text ? <div className="whitespace-pre-wrap leading-relaxed">{withCitations(m.text, m.citations)}</div> : <Spinner label={c("loading")} />}
              {m.citations && m.citations.length > 0 && (
                <div className="mt-3 border-t border-line pt-2">
                  <p className="text-xs font-semibold text-muted">{t("sources")}</p>
                  <ol className="mt-1 list-decimal pl-5 text-sm">
                    {m.citations.map((ci) => (
                      <li key={ci.source_id}>
                        {ci.url ? (
                          <a href={ci.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-saffron underline">
                            {ci.title} <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          ci.title
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </Card>
          ),
        )}
        <div ref={endRef} />
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="sticky bottom-20 flex flex-col gap-2 rounded-2xl border border-line bg-bg/95 p-2 backdrop-blur sm:bottom-4 sm:flex-row"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("placeholder")} className={inputClass} aria-label={t("placeholder")} />
        <div className="flex gap-2">
          <VoiceRecorder onText={(text) => ask(text)} labels={{ idle: t("voice"), recording: t("listening"), working: c("loading") }} />
          <Button type="submit" disabled={busy || q.trim().length < 2}>
            <Send className="size-5" /> {t("send")}
          </Button>
        </div>
      </form>
    </div>
  );
}
