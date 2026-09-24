"use client";
import type { Health } from "@janseva/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/** Status dot for the AI service: green with a model, amber in rules-only mode, red if down. */
export function HealthBadge() {
  const t = useTranslations("common");
  const [h, setH] = useState<Health | null | "down">(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/ai/health")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: Health) => alive && setH(d))
      .catch(() => alive && setH("down"));
    return () => {
      alive = false;
    };
  }, []);
  if (h === null) return null;
  const tone = h === "down" ? "bg-danger" : h.status === "ok" ? "bg-green" : "bg-warn";
  const title =
    h === "down"
      ? `${t("aiStatus")}: offline`
      : h.status === "ok"
        ? `${t("aiStatus")}: ${Object.entries(h.providers).filter(([, v]) => v).map(([k]) => k).join(", ")}`
        : `${t("aiStatus")}: ${t("rulesMode")}`;
  return (
    <span title={title} aria-label={title} className="flex items-center gap-1.5 text-xs text-muted">
      <span className={`size-2.5 rounded-full ${tone}`} />
      <span className="hidden md:inline">AI</span>
    </span>
  );
}
