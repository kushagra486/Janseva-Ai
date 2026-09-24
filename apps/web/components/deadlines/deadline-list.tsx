"use client";
import { type Deadline, reminderDates } from "@janseva/shared";
import { Bell, BellRing, Check, Plus, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { saveDeadline, setDeadlineStatus } from "@/app/actions";
import { Badge, Button, Card, inputClass, Label } from "@/components/ui";
import { VAPID_PUBLIC_KEY } from "@/lib/env";
import { localDeadlines, localNotices, newId, type SavedNotice } from "@/lib/local-store";

const noop = () => () => {};

function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysLeft(due: string, today: string) {
  return Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
}

function urlBase64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

export function DeadlineList({ server, signedIn }: { server: Deadline[]; signedIn: boolean }) {
  const t = useTranslations("deadlines");
  const [local, setLocal] = useState<Deadline[]>([]);
  const [notices, setNotices] = useState<SavedNotice[]>([]);
  const pushSupported = useSyncExternalStore(noop, () => "serviceWorker" in navigator && "PushManager" in window, () => false);
  const [push, setPush] = useState<"unknown" | "on" | "off">("unknown");
  // Status overrides for server-backed rows changed in this session.
  const [hidden, setHidden] = useState<Record<string, "done" | "dismissed">>({});
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const today = todayIST();

  useEffect(() => {
    const sync = () => {
      setLocal(localDeadlines.list());
      setNotices(localNotices.list());
    };
    sync();
    window.addEventListener("janseva-storage", sync);
    if ("serviceWorker" in navigator && "PushManager" in window)
      navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setPush(s ? "on" : "off")).catch(() => setPush("off"));
    return () => window.removeEventListener("janseva-storage", sync);
  }, []);

  const all = useMemo(() => {
    const byId = new Map<string, Deadline>();
    for (const d of [...server, ...local]) byId.set(d.id, hidden[d.id] ? { ...d, status: hidden[d.id] } : d);
    return [...byId.values()].filter((d) => d.status !== "dismissed").sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [server, local, hidden]);

  async function enablePush() {
    if (!VAPID_PUBLIC_KEY) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    setPush("on");
  }

  async function add() {
    if (!title.trim() || !date) return;
    const d: Deadline = { id: newId(), title: title.trim(), due_date: date, status: "active" };
    localDeadlines.add(d);
    await saveDeadline(d);
    setTitle("");
    setDate("");
  }

  return (
    <div className="space-y-5">
      {signedIn && pushSupported && VAPID_PUBLIC_KEY && (
        <Button variant="secondary" onClick={enablePush} disabled={push === "on"}>
          {push === "on" ? <BellRing className="size-5 text-green" /> : <Bell className="size-5" />}
          {push === "on" ? t("pushOn") : t("enablePush")}
        </Button>
      )}

      {all.length === 0 && <p className="text-muted">{t("empty")}</p>}
      <ul className="space-y-3">
        {all.map((d) => {
          const left = daysLeft(d.due_date, today);
          const done = d.status === "done";
          return (
            <li key={d.id}>
              <Card className={done ? "opacity-60" : left <= 2 ? "border-danger/50" : left <= 7 ? "border-warn/50" : ""}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-semibold">{d.title}</p>
                    {d.notice_summary && <p className="text-sm text-muted">{d.notice_summary}</p>}
                    <p className="text-sm">{new Date(d.due_date + "T00:00:00").toLocaleDateString()}</p>
                  </div>
                  {!done && (left < 0 ? <Badge tone="danger">{t("overdue")}</Badge> : <Badge tone={left <= 2 ? "danger" : left <= 7 ? "warn" : "green"}>{t("daysLeft", { days: left })}</Badge>)}
                </div>
                {!done && left >= 0 && (
                  <p className="mt-2 text-xs text-muted">
                    {t("reminders")}: {reminderDates(d.due_date, today).map((x) => new Date(x + "T00:00:00").toLocaleDateString()).join(" · ")}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  {!done && (
                    <Button variant="secondary" onClick={() => {
                        localDeadlines.update(d.id, { status: "done" });
                        setHidden((h) => ({ ...h, [d.id]: "done" }));
                        setDeadlineStatus(d.id, "done");
                      }}>
                      <Check className="size-4" /> {t("done")}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => {
                      localDeadlines.remove(d.id);
                      setHidden((h) => ({ ...h, [d.id]: "dismissed" }));
                      setDeadlineStatus(d.id, "dismissed");
                    }} aria-label={t("remove")}>
                    <Trash className="size-4" />
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      <Card className="space-y-3">
        <h2 className="font-semibold">{t("addManual")}</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div>
            <Label htmlFor="dl-title">{t("titleField")}</Label>
            <input id="dl-title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </div>
          <div>
            <Label htmlFor="dl-date">{t("dateField")}</Label>
            <input id="dl-date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </div>
        </div>
        <Button onClick={add} disabled={!title.trim() || !date}>
          <Plus className="size-5" /> {t("addManual")}
        </Button>
      </Card>

      {notices.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t("savedNotices")}</h2>
          <ul className="space-y-2">
            {notices.map((n) => (
              <li key={n.id}>
                <details className="rounded-xl border border-line bg-surface p-3">
                  <summary className="cursor-pointer">{n.decoded.explanation.what_it_is}</summary>
                  <div className="mt-2 space-y-1 text-sm">
                    {n.decoded.explanation.what_you_owe && <p>{n.decoded.explanation.what_you_owe}</p>}
                    {n.decoded.explanation.deadline && <p>{n.decoded.explanation.deadline}</p>}
                    <ul className="list-disc pl-5">{n.decoded.explanation.do_this_now.map((s) => <li key={s}>{s}</li>)}</ul>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
