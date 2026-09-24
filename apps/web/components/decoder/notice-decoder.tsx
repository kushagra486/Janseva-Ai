"use client";
import type { DecodeResponse, Lang } from "@janseva/shared";
import { AlertTriangle, BellPlus, Camera, CheckCircle2, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { saveDeadline } from "@/app/actions";
import { ReadAloud } from "@/components/read-aloud";
import { Badge, Button, Card, ConfidenceBar, ErrorBox, inputClass, Spinner } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { decodeFile, decodeFilePath, decodeText } from "@/lib/ai-client";
import { localDeadlines, localNotices, newId } from "@/lib/local-store";
import { SAMPLE_NOTICE } from "@/lib/samples";
import { getBrowserSupabase } from "@/lib/supabase/client";

type Input = { kind: "text"; text: string } | { kind: "file"; file: File; path?: string };

const FIELD_ORDER = ["notice_type", "authority", "amount", "deadline", "penalty", "reference", "period"] as const;

export function NoticeDecoder({ uploadAs }: { uploadAs: string | null }) {
  const t = useTranslations("decode");
  const c = useTranslations("common");
  const locale = useLocale() as Lang;
  const [lang, setLang] = useState<Lang>(locale);
  const [text, setText] = useState("");
  const [input, setInput] = useState<Input | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<Lang, DecodeResponse>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saved" | "none" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const result = results[lang];

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function run(inp: Input, l: Lang) {
    setBusy(true);
    setError(null);
    try {
      let r: DecodeResponse;
      if (inp.kind === "text") r = await decodeText(inp.text, l);
      else if (inp.path) r = await decodeFilePath(inp.path, l);
      else r = await decodeFile(inp.file, l);
      setResults((prev) => ({ ...prev, [l]: r }));
      localNotices.add({ id: newId(), savedAt: new Date().toISOString(), decoded: r });
    } catch (e) {
      setError(e instanceof Error ? e.message : c("error"));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    setPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
    let inp: Input = { kind: "file", file };
    // Signed in: keep the original in the private "notices" bucket so it stays one tap away.
    const supabase = getBrowserSupabase();
    if (supabase && uploadAs) {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${uploadAs}/${newId()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("notices").upload(path, file, { contentType: file.type });
      if (!upErr) inp = { kind: "file", file, path };
    }
    setInput(inp);
    setResults({});
    setSaved(null);
    await run(inp, lang);
  }

  async function onText(value: string) {
    const inp: Input = { kind: "text", text: value };
    setInput(inp);
    setResults({});
    setSaved(null);
    setPreview(null);
    await run(inp, lang);
  }

  async function switchLang(l: Lang) {
    setLang(l);
    if (input && !results[l]) await run(input, l);
  }

  async function remind() {
    if (!result) return;
    const due = result.fields.deadline.value;
    if (typeof due !== "string") {
      setSaved("none");
      return;
    }
    const deadline = {
      id: newId(),
      title: result.explanation.what_it_is,
      due_date: due,
      notice_summary: result.explanation.what_you_owe ?? undefined,
      amount: typeof result.fields.amount.value === "number" ? result.fields.amount.value : null,
      status: "active" as const,
    };
    localDeadlines.add(deadline);
    await saveDeadline(deadline, result, input?.kind === "file" ? input.path : undefined);
    setSaved("saved");
  }

  const spoken = result
    ? [result.explanation.what_it_is, result.explanation.what_you_owe, result.explanation.deadline, result.explanation.if_you_miss_it, ...result.explanation.do_this_now]
        .filter(Boolean)
        .join(". ")
    : "";

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,text/plain"
          capture="environment"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <Button className="w-full text-lg" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Camera className="size-6" /> {t("takePhoto")}
        </Button>
        <p className="text-xs text-muted">{t("retakeTips")}</p>

        <details className="group">
          <summary className="cursor-pointer text-sm text-muted">{t("orPaste")}</summary>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={t("pastePlaceholder")}
            className={`${inputClass} mt-2`}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onText(text)} disabled={busy || text.trim().length < 15}>
              <FileText className="size-5" /> {t("decode")}
            </Button>
          </div>
        </details>
        <Button
          variant="ghost"
          className="text-saffron"
          onClick={() => {
            setText(SAMPLE_NOTICE);
            onText(SAMPLE_NOTICE);
          }}
          disabled={busy}
        >
          {t("tryDemo")}
        </Button>

        <p className="flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="size-4 shrink-0 text-green" /> {t("privacy")}
        </p>
      </Card>

      {busy && <Spinner label={c("loading")} />}
      {error && (
        <ErrorBox>
          {error} <span className="block text-sm">{t("retakeTips")}</span>
        </ErrorBox>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">{t("explainIn")}:</span>
            {(["hi", "en"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => switchLang(l)}
                aria-pressed={lang === l}
                className={`min-h-10 rounded-lg border px-3 text-sm ${lang === l ? "border-saffron bg-saffron/15 text-saffron" : "border-line"}`}
              >
                {l === "hi" ? "हिन्दी" : "English"}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-2 text-sm text-muted">
              {t("confidence")} <ConfidenceBar value={result.confidence} />
            </span>
          </div>

          <Card className="space-y-4 border-saffron/40">
            <Section label={t("whatItIs")}>{result.explanation.what_it_is}</Section>
            {result.explanation.what_you_owe && (
              <Section label={t("youOwe")} emphasis flagged={result.low_confidence_fields.includes("amount")} flagText={t("checkField")}>
                {result.explanation.what_you_owe}
              </Section>
            )}
            <Section label={t("deadline")} emphasis flagged={result.low_confidence_fields.includes("deadline")} flagText={t("checkField")}>
              {result.explanation.deadline}
            </Section>
            {result.explanation.if_you_miss_it && <Section label={t("ifMissed")}>{result.explanation.if_you_miss_it}</Section>}
            <div>
              <h3 className="text-sm font-semibold text-green">{t("doThisNow")}</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {result.explanation.do_this_now.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={remind} disabled={saved === "saved"}>
                {saved === "saved" ? <CheckCircle2 className="size-5" /> : <BellPlus className="size-5" />} {t("remindMe")}
              </Button>
              <ReadAloud text={spoken} lang={lang} labels={{ play: t("readAloud"), stop: t("stop") }} />
            </div>
            {saved === "saved" && <p className="text-sm text-green">{t("reminderSaved")}</p>}
            {saved === "none" && <p className="text-sm text-warn">{t("noDeadline")}</p>}
          </Card>

          <Card>
            <h3 className="mb-2 font-semibold">{t("fields")}</h3>
            <dl className="divide-y divide-line">
              {FIELD_ORDER.map((k) => {
                const f = result.fields[k];
                if (f.value == null) return null;
                const low = result.low_confidence_fields.includes(k);
                return (
                  <div key={k} className={`grid grid-cols-[7rem_1fr] gap-2 py-2 ${low ? "rounded-lg bg-warn/10 px-2" : ""}`}>
                    <dt className="text-sm text-muted">{t(`field.${k}`)}</dt>
                    <dd className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-words">{k === "amount"
                          ? `₹${Number(f.value).toLocaleString("en-IN")}`
                          : k === "notice_type" && t.has(`types.${f.value}`)
                            ? t(`types.${f.value}`)
                            : String(f.value)}</span>
                      <span className="flex items-center gap-2">
                        {low && <Badge tone="warn"><AlertTriangle className="size-3" /> {t("checkField")}</Badge>}
                        <ConfidenceBar value={f.confidence} />
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-saffron">{t("original")}</summary>
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL
                <img src={preview} alt="" className="mt-2 max-h-96 rounded-lg border border-line" />
              )}
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm text-muted">{result.masked_text}</pre>
            </details>
          </Card>

          {result.citations.length > 0 && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold text-muted">{c("source")}</h3>
              <ul className="space-y-1">
                {result.citations.map((ci) => (
                  <li key={ci.source_id}>
                    {ci.url ? (
                      <a href={ci.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-saffron underline">
                        {ci.title} <ExternalLink className="size-3.5" />
                      </a>
                    ) : (
                      ci.title
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap gap-2">
            <Link href={{ pathname: "/services", query: { q: result.explanation.what_it_is } }} className="rounded-xl border border-line px-4 py-3 text-sm">
              {t("askFollowUp")}
            </Link>
            <Link href="/report" className="rounded-xl border border-line px-4 py-3 text-sm">
              {t("reportIssue")}
            </Link>
          </div>
          <p className="text-xs text-muted">{result.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  children,
  emphasis,
  flagged,
  flagText,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: boolean;
  flagged?: boolean;
  flagText?: string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted">{label}</h3>
      <p className={emphasis ? "text-xl font-semibold" : "text-lg"}>{children}</p>
      {flagged && (
        <p className="mt-1 inline-flex items-center gap-1 text-sm text-warn">
          <AlertTriangle className="size-4" /> {flagText}
        </p>
      )}
    </div>
  );
}
