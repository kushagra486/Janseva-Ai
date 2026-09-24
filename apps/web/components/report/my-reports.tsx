"use client";
import type { Report } from "@janseva/shared";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Spinner } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/ai-client";
import { useLive } from "@/lib/use-live";

export function MyReports() {
  const t = useTranslations("report");
  const tl = useTranslations("timeline");
  const [reports, setReports] = useState<Report[] | null>(null);
  const load = useCallback(() => {
    api<Report[]>("/v1/reports/mine").then(setReports).catch(() => setReports([]));
  }, []);
  useEffect(load, [load]);
  useLive(["report_events"], load, 10_000);

  if (reports === null) return <Spinner />;
  if (reports.length === 0) return <p className="text-muted">{t("noReports")}</p>;
  return (
    <ul className="space-y-2">
      {reports.map((r) => (
        <li key={r.id}>
          <Link href={`/report/${r.id}`}>
            <Card className="flex items-center justify-between gap-3 hover:border-saffron/50">
              <span className="min-w-0">
                <span className="block truncate">{r.text || t(`categories.${r.category}`)}</span>
                <span className="text-xs text-muted">{new Date(r.created_at).toLocaleString()}</span>
              </span>
              <Badge tone={r.status === "verified" ? "green" : r.status === "rejected" ? "danger" : "saffron"}>{tl(`status.${r.status}`)}</Badge>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
