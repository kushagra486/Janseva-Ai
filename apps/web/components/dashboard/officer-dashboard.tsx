"use client";
import type { Analytics, Cluster, Report } from "@janseva/shared";
import { Check, Clock, Hammer, Pencil, ShieldCheck, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { decidePlan, updateClusterStatus } from "@/app/actions";
import { CATEGORY_COLORS, MapView } from "@/components/map";
import { Badge, Button, Card, ErrorBox, inputClass, Label, Spinner } from "@/components/ui";
import { api } from "@/lib/ai-client";
import { useLive } from "@/lib/use-live";
import { AnalyticsCharts } from "./analytics-charts";

type Dept = { id: string; name: string; categories: string[]; sla_hours: number };
const QUEUE = new Set(["awaiting_approval", "reopened"]);

function slaHoursLeft(c: Cluster): number | null {
  if (!c.plan?.due_at || !["assigned", "in_progress"].includes(c.status)) return null;
  return Math.round((Date.parse(c.plan.due_at) - Date.now()) / 3_600_000);
}

export function OfficerDashboard() {
  const t = useTranslations("dashboard");
  const r = useTranslations("report");
  const tl = useTranslations("timeline");
  const c = useTranslations("common");
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [tab, setTab] = useState<"queue" | "all" | "analytics">("queue");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api<Cluster[]>("/v1/clusters"), api<Analytics>("/v1/analytics")])
      .then(([cs, an]) => {
        setClusters(cs);
        setAnalytics(an);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : c("error")));
  }, [c]);
  useEffect(() => {
    load();
    api<Dept[]>("/v1/departments").then(setDepts).catch(() => {});
  }, [load]);
  useLive(["clusters", "report_events"], load);

  const shown = useMemo(
    () => (clusters ?? []).filter((x) => (tab === "queue" ? QUEUE.has(x.status) : true)),
    [clusters, tab],
  );
  const current = clusters?.find((x) => x.id === selected) ?? null;

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!clusters) return <Spinner label={c("loading")} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {(["queue", "all", "analytics"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`min-h-11 rounded-xl border px-4 ${tab === k ? "border-saffron bg-saffron/15 text-saffron" : "border-line"}`}
          >
            {t(k)}
            {k === "queue" && <span className="ml-2 rounded-full bg-saffron px-2 text-xs text-saffron-ink">{clusters.filter((x) => QUEUE.has(x.status)).length}</span>}
          </button>
        ))}
      </div>

      {tab === "analytics" ? (
        analytics && <AnalyticsCharts data={analytics} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="space-y-3">
            <MapView
              height={340}
              onSelect={setSelected}
              pins={shown.map((x) => ({
                id: x.id,
                lat: x.centroid.lat,
                lng: x.centroid.lng,
                weight: x.report_count,
                color: CATEGORY_COLORS[x.category],
                selected: x.id === selected,
                label: `${r(`categories.${x.category}`)} · ${t("reports", { count: x.report_count })}`,
              }))}
            />
            {shown.length === 0 && <p className="text-muted">{t("noIssues")}</p>}
            <ul className="space-y-2">
              {shown.map((x) => {
                const left = slaHoursLeft(x);
                return (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(x.id)}
                      className={`w-full rounded-xl border p-3 text-left ${x.id === selected ? "border-saffron bg-saffron/10" : "border-line bg-surface hover:border-saffron/50"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <span className="size-3 rounded-full" style={{ background: CATEGORY_COLORS[x.category] }} />
                          <span className="font-semibold">{r(`categories.${x.category}`)}</span>
                          <Badge>{t("reports", { count: x.report_count })}</Badge>
                        </span>
                        <span className="text-xs text-muted">{t("priority")} {x.priority.toFixed(1)}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted">{x.title}</p>
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Badge tone={QUEUE.has(x.status) ? "saffron" : x.status === "verified" ? "green" : "muted"}>{tl(`status.${x.status}`)}</Badge>
                        <Badge tone={x.severity >= 4 ? "danger" : "muted"}>{t("severity")} {x.severity}/5</Badge>
                        {left !== null && (
                          <Badge tone={left < 0 ? "danger" : left < 12 ? "warn" : "green"}>
                            <Clock className="size-3" /> {left < 0 ? t("slaBreached") : t("slaLeft", { hours: left })}
                          </Badge>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="lg:sticky lg:top-24 lg:self-start">
            {current ? <ClusterPanel key={current.id + current.updated_at} cluster={current} depts={depts} onChange={load} /> : <Card className="text-muted">{t("humanGate")}</Card>}
          </div>
        </div>
      )}
    </div>
  );
}

function ClusterPanel({ cluster, depts, onChange }: { cluster: Cluster; depts: Dept[]; onChange: () => void }) {
  const t = useTranslations("dashboard");
  const r = useTranslations("report");
  const tl = useTranslations("timeline");
  const c = useTranslations("common");
  const plan = cluster.plan;
  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState(plan?.steps.join("\n") ?? "");
  const [dept, setDept] = useState(plan?.department_id ?? "");
  const [sla, setSla] = useState(plan?.sla_hours ?? 72);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<Report[]>([]);

  useEffect(() => {
    api<{ reports: Report[] }>(`/v1/clusters/${cluster.id}`).then((d) => setReports(d.reports)).catch(() => {});
  }, [cluster.id]);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) setError(res.error ?? c("error"));
    else {
      setEditing(false);
      setRejecting(false);
      onChange();
    }
  }

  const awaiting = cluster.status === "awaiting_approval" || cluster.status === "reopened";

  return (
    <Card className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full" style={{ background: CATEGORY_COLORS[cluster.category] }} />
          <h2 className="text-lg font-semibold">{r(`categories.${cluster.category}`)}</h2>
          <Badge tone="saffron">{tl(`status.${cluster.status}`)}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">{cluster.title}</p>
      </div>

      {plan && (
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t("plan")}</h3>
            <span className="text-xs text-muted">{t("draftedBy", { by: plan.drafted_by })}</span>
          </div>
          {editing ? (
            <div className="mt-2 space-y-3">
              <div>
                <Label htmlFor="steps">{t("plan")}</Label>
                <textarea id="steps" rows={4} value={steps} onChange={(e) => setSteps(e.target.value)} className={inputClass} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="dept">{t("department")}</Label>
                  <select id="dept" value={dept} onChange={(e) => setDept(e.target.value)} className={inputClass}>
                    {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="sla">{t("sla")}</Label>
                  <input id="sla" type="number" min={1} value={sla} onChange={(e) => setSla(Number(e.target.value))} className={inputClass} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => act(() => decidePlan(cluster.id, { decision: "edit", steps: steps.split("\n").filter((s) => s.trim()), department_id: dept, sla_hours: sla }))}
                >
                  {t("saveEdit")}
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>{c("cancel")}</Button>
              </div>
            </div>
          ) : (
            <>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {plan.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              <p className="mt-2 text-sm"><span className="text-muted">{t("department")}:</span> {plan.department_name}</p>
              <p className="text-sm"><span className="text-muted">{t("sla")}:</span> {plan.sla_hours}</p>
            </>
          )}
        </div>
      )}

      {awaiting && !editing && (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-green"><ShieldCheck className="size-4" /> {t("humanGate")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="success" disabled={busy} onClick={() => act(() => decidePlan(cluster.id, { decision: "approve" }))}>
              <Check className="size-5" /> {t("approve")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> {t("edit")}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => setRejecting((v) => !v)}>
              <X className="size-4" /> {t("reject")}
            </Button>
          </div>
          {rejecting && (
            <div className="flex gap-2">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("rejectReason")} className={inputClass} aria-label={t("rejectReason")} />
              <Button variant="danger" disabled={busy || !reason.trim()} onClick={() => act(() => decidePlan(cluster.id, { decision: "reject", note: reason }))}>
                {t("reject")}
              </Button>
            </div>
          )}
        </div>
      )}

      {cluster.status === "assigned" && (
        <Button variant="secondary" disabled={busy} onClick={() => act(() => updateClusterStatus(cluster.id, "in_progress"))}>
          <Hammer className="size-4" /> {t("startWork")}
        </Button>
      )}
      {(cluster.status === "assigned" || cluster.status === "in_progress") && (
        <Button variant="success" disabled={busy} onClick={() => act(() => updateClusterStatus(cluster.id, "resolved"))}>
          <Check className="size-4" /> {t("resolve")}
        </Button>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      {reports.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-muted">{t("viewReports")} ({reports.length})</summary>
          <ul className="mt-2 space-y-2 text-sm">
            {reports.map((x) => (
              <li key={x.id} className="rounded-lg bg-surface-2 p-2">
                <p>{x.text}</p>
                <p className="text-xs text-muted">
                  {new Date(x.created_at).toLocaleString()} · {r("severity")} {x.severity}/5
                  {x.flags.length > 0 && ` · ${x.flags.join(", ")}`}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
