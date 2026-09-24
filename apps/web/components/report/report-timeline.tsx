"use client";
import type { Cluster, Report, ReportEvent } from "@janseva/shared";
import { CheckCircle2, Circle, Radio, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { CATEGORY_COLORS, MapView } from "@/components/map";
import { Badge, Button, Card, ErrorBox, inputClass, Label, PageHeader, Spinner } from "@/components/ui";
import { api, postJson } from "@/lib/ai-client";
import { useLive } from "@/lib/use-live";

type Detail = { report: Report | null; cluster: Cluster | null; timeline: ReportEvent[] };
type Verify = { verdict: "fixed" | "not_fixed" | "uncertain"; change_score: number; note: string };

export function ReportTimeline({ id }: { id: string }) {
  const t = useTranslations("timeline");
  const r = useTranslations("report");
  const c = useTranslations("common");
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Detail>(`/v1/reports/${id}`)
      .then(setD)
      .catch((e) => setError(e instanceof Error ? e.message : c("error")));
  }, [id, c]);
  useEffect(load, [load]);
  useLive(["report_events", "clusters"], load);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!d) return <Spinner label={c("loading")} />;
  const cl = d.cluster;
  const status = d.timeline.at(-1)?.status ?? d.report?.status;

  return (
    <div className="space-y-5">
      <PageHeader title={d.report?.text || (cl ? r(`categories.${cl.category}`) : t("title"))} />
      <div className="flex flex-wrap items-center gap-2">
        {cl && <Badge tone="saffron">{r(`categories.${cl.category}`)}</Badge>}
        {status && <Badge tone="green">{t(`status.${status}`)}</Badge>}
        {cl && cl.report_count > 1 && <Badge>{t("reportsHere", { count: cl.report_count })}</Badge>}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-green"><Radio className="size-3.5" /> {t("live")}</span>
      </div>

      {cl?.plan && cl.plan.status === "approved" && (
        <Card className="grid gap-2 sm:grid-cols-2">
          <p><span className="block text-xs text-muted">{t("department")}</span>{cl.plan.department_name}</p>
          {cl.plan.due_at && <p><span className="block text-xs text-muted">{t("due")}</span>{new Date(cl.plan.due_at).toLocaleString()}</p>}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-semibold">{t("title")}</h2>
        <ol className="relative space-y-4 border-l border-line pl-6">
          {d.timeline.map((e, i) => {
            const last = i === d.timeline.length - 1;
            return (
              <li key={e.id} className="relative">
                <span className="absolute -left-[33px] top-0.5 grid size-5 place-items-center rounded-full bg-bg">
                  {last ? <CheckCircle2 className="size-5 text-saffron" /> : <Circle className="size-4 text-muted" />}
                </span>
                <p className={last ? "font-semibold" : ""}>{t(`status.${e.status}`)}</p>
                <p className="text-sm text-muted">{e.note}</p>
                <p className="text-xs text-muted/70">{new Date(e.created_at).toLocaleString()} · {e.actor}</p>
              </li>
            );
          })}
        </ol>
      </Card>

      {cl && (
        <MapView center={[cl.centroid.lat, cl.centroid.lng]} zoom={16} height={220} pins={[{ id: cl.id, lat: cl.centroid.lat, lng: cl.centroid.lng, label: cl.title, weight: cl.report_count, color: CATEGORY_COLORS[cl.category] }]} />
      )}

      {d.report && d.report.status === "resolved" && <ConfirmFix report={d.report} onDone={load} />}
    </div>
  );
}

function ConfirmFix({ report, onDone }: { report: Report; onDone: () => void }) {
  const t = useTranslations("timeline");
  const c = useTranslations("common");
  const [after, setAfter] = useState<File | null>(null);
  const [before, setBefore] = useState<File | null>(null);
  const [check, setCheck] = useState<Verify | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compare() {
    if (!after) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("after", after);
      if (before) fd.append("before", before);
      setCheck(await api<Verify>(`/v1/reports/${report.id}/verify`, { method: "POST", body: fd }));
    } catch (e) {
      setError(e instanceof Error ? e.message : c("error"));
    } finally {
      setBusy(false);
    }
  }

  async function answer(confirmed: boolean) {
    setBusy(true);
    try {
      await postJson(`/v1/reports/${report.id}/feedback`, { confirmed, rating: rating || null, comment: comment || null });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : c("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 border-green/50">
      <div>
        <h2 className="text-lg font-semibold">{t("confirmTitle")}</h2>
        <p className="text-sm text-muted">{t("confirmBody")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="after">{t("afterPhoto")}</Label>
          <input id="after" type="file" accept="image/*" capture="environment" onChange={(e) => setAfter(e.target.files?.[0] ?? null)} className={inputClass} />
        </div>
        {!report.photo_path && (
          <div>
            <Label htmlFor="before">{t("beforePhoto")}</Label>
            <input id="before" type="file" accept="image/*" onChange={(e) => setBefore(e.target.files?.[0] ?? null)} className={inputClass} />
          </div>
        )}
      </div>
      <Button variant="secondary" onClick={compare} disabled={!after || busy || (!report.photo_path && !before)}>
        {t("checkPhoto")}
      </Button>
      {check && (
        <p className={check.verdict === "fixed" ? "text-green" : check.verdict === "not_fixed" ? "text-danger" : "text-warn"}>{check.note}</p>
      )}
      <div>
        <Label>{t("rating")}</Label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n}`} className="grid size-11 place-items-center">
              <Star className={`size-7 ${n <= rating ? "fill-saffron text-saffron" : "text-muted"}`} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label htmlFor="comment">{t("comment")}</Label>
        <input id="comment" value={comment} onChange={(e) => setComment(e.target.value)} className={inputClass} />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex flex-wrap gap-2">
        <Button variant="success" onClick={() => answer(true)} disabled={busy}>{t("yesFixed")}</Button>
        <Button variant="danger" onClick={() => answer(false)} disabled={busy}>{t("notFixed")}</Button>
      </div>
    </Card>
  );
}
