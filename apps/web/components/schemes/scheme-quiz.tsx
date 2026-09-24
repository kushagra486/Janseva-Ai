"use client";
import {
  GENDERS,
  INCOME_BANDS,
  type Lang,
  OCCUPATIONS,
  SOCIAL_CATEGORIES,
  type SchemeAnswers,
  type SchemeMatchResponse,
} from "@janseva/shared";
import { CheckCircle2, CircleHelp, ExternalLink, FileCheck2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Badge, Button, Card, ErrorBox, inputClass, Spinner } from "@/components/ui";
import { matchSchemes } from "@/lib/ai-client";

type Draft = Partial<Omit<SchemeAnswers, "language">>;
const UP_DISTRICTS = ["Lucknow", "Kanpur Nagar", "Varanasi", "Prayagraj", "Agra", "Gorakhpur", "Bareilly", "Meerut", "Ghaziabad", "Ayodhya", "Other"];
const TOTAL = 6;

function Choice<T extends string>({ options, value, onPick, label }: { options: readonly T[]; value?: T; onPick: (v: T) => void; label: (v: T) => string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onPick(o)}
          aria-pressed={value === o}
          className={`min-h-14 rounded-xl border px-4 text-left text-lg ${value === o ? "border-saffron bg-saffron/15" : "border-line bg-surface-2 hover:border-saffron/50"}`}
        >
          {label(o)}
        </button>
      ))}
    </div>
  );
}

export function SchemeQuiz() {
  const t = useTranslations("schemes");
  const c = useTranslations("common");
  const language = useLocale() as Lang;
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Draft>({ district: "Lucknow", widowed: false, disability: false });
  const [result, setResult] = useState<SchemeMatchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Draft) => setA((prev) => ({ ...prev, ...patch }));
  const pickAndNext = (patch: Draft) => {
    set(patch);
    setStep((s) => Math.min(s + 1, TOTAL - 1));
  };

  async function submit(answers: Draft) {
    setBusy(true);
    setError(null);
    try {
      setResult(await matchSchemes({ ...(answers as Required<Draft>), language }));
    } catch (e) {
      setError(e instanceof Error ? e.message : c("error"));
    } finally {
      setBusy(false);
    }
  }

  const complete = a.age != null && a.gender && a.income_band && a.occupation && a.category && a.district;

  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">{t("results", { count: result.matches.length })}</h2>
          <span className="text-sm text-muted">{t("evaluated", { count: result.evaluated })}</span>
        </div>
        {result.matches.length === 0 && <Card>{t("none")}</Card>}
        {result.matches.map((m) => (
          <Card key={m.id} className={m.status === "eligible" ? "border-green/50" : "border-warn/40"}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-lg font-semibold">{m.name}</h3>
              {m.status === "eligible" ? (
                <Badge tone="green"><CheckCircle2 className="size-3.5" /> {t("eligible")}</Badge>
              ) : (
                <Badge tone="warn"><CircleHelp className="size-3.5" /> {t("needsCheck")}</Badge>
              )}
            </div>
            <p className="mt-1 text-saffron">{m.benefit}</p>
            <p className="mt-2">{m.explanation}</p>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-muted">{t("why")}</summary>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {m.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </details>
            {m.checks.length > 0 && (
              <div className="mt-2 rounded-lg bg-warn/10 p-2 text-sm">
                <p className="font-semibold text-warn">{t("toCheck")}</p>
                <ul className="list-disc pl-5">{m.checks.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
            <div className="mt-3">
              <p className="flex items-center gap-1 text-sm font-semibold text-muted"><FileCheck2 className="size-4" /> {t("documents")}</p>
              <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                {m.documents.map((d) => (
                  <li key={d} className="flex items-center gap-2">
                    <input type="checkbox" className="size-5 accent-[var(--color-green)]" aria-label={d} /> {d}
                  </li>
                ))}
              </ul>
            </div>
            {m.apply_url && (
              <a href={m.apply_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-saffron underline">
                {t("apply")}: {new URL(m.apply_url).hostname} <ExternalLink className="size-3.5" />
              </a>
            )}
          </Card>
        ))}
        <Button variant="secondary" onClick={() => { setResult(null); setStep(0); }}>{t("startOver")}</Button>
        <p className="text-xs text-muted">{c("disclaimer")}</p>
      </div>
    );
  }

  const questions = [
    <div key="age">
      <label htmlFor="age" className="mb-2 block text-lg font-semibold">{t("age")}</label>
      <input
        id="age"
        type="number"
        inputMode="numeric"
        min={0}
        max={120}
        value={a.age ?? ""}
        onChange={(e) => set({ age: e.target.value === "" ? undefined : Math.max(0, Math.min(120, Number(e.target.value))) })}
        className={`${inputClass} text-2xl`}
      />
    </div>,
    <div key="gender">
      <p className="mb-2 text-lg font-semibold">{t("gender")}</p>
      <Choice options={GENDERS} value={a.gender} onPick={(v) => pickAndNext({ gender: v })} label={(v) => t(`genders.${v}`)} />
    </div>,
    <div key="income">
      <p className="mb-2 text-lg font-semibold">{t("income")}</p>
      <Choice options={INCOME_BANDS} value={a.income_band} onPick={(v) => pickAndNext({ income_band: v })} label={(v) => t(`incomes.${v}`)} />
    </div>,
    <div key="occupation">
      <p className="mb-2 text-lg font-semibold">{t("occupation")}</p>
      <Choice options={OCCUPATIONS} value={a.occupation} onPick={(v) => pickAndNext({ occupation: v })} label={(v) => t(`occupations.${v}`)} />
    </div>,
    <div key="category">
      <p className="mb-2 text-lg font-semibold">{t("category")}</p>
      <Choice options={SOCIAL_CATEGORIES} value={a.category} onPick={(v) => pickAndNext({ category: v })} label={(v) => t(`categories.${v}`)} />
    </div>,
    <div key="district" className="space-y-4">
      <div>
        <label htmlFor="district" className="mb-2 block text-lg font-semibold">{t("district")}</label>
        <select id="district" value={a.district} onChange={(e) => set({ district: e.target.value })} className={inputClass}>
          {UP_DISTRICTS.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm text-muted">{t("situations")}</legend>
        {(["widowed", "disability"] as const).map((k) => (
          <label key={k} className="flex min-h-12 items-center gap-3 text-lg">
            <input type="checkbox" checked={Boolean(a[k])} onChange={(e) => set({ [k]: e.target.checked })} className="size-6 accent-[var(--color-saffron)]" />
            {t(k)}
          </label>
        ))}
      </fieldset>
    </div>,
  ];

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        className="text-saffron"
        onClick={() => {
          const sunita: Draft = { age: 62, gender: "female", income_band: "below_50k", occupation: "homemaker", category: "obc", district: "Lucknow", widowed: true, disability: false };
          setA(sunita);
          submit(sunita);
        }}
      >
        {t("sunita")}
      </Button>
      <Card>
        <p className="mb-3 text-sm text-muted">{t("step", { n: step + 1, total: TOTAL })}</p>
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-saffron transition-all" style={{ width: `${((step + 1) / TOTAL) * 100}%` }} />
        </div>
        {questions[step]}
        <div className="mt-5 flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            {t("back")}
          </Button>
          {step < TOTAL - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 && a.age == null}>
              {t("next")}
            </Button>
          ) : (
            <Button onClick={() => submit(a)} disabled={!complete || busy}>
              {t("find")}
            </Button>
          )}
        </div>
      </Card>
      {busy && <Spinner label={c("loading")} />}
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
