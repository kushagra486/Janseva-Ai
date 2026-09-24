"use client";
import type { Analytics } from "@janseva/shared";
import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CATEGORY_COLORS } from "@/components/map";
import { Card } from "@/components/ui";

const AXIS = { stroke: "#9aa7c2", fontSize: 12 };
const TOOLTIP = { contentStyle: { background: "#17223b", border: "1px solid #26324f", borderRadius: 8, color: "#e8edf7" } };

export function AnalyticsCharts({ data }: { data: Analytics }) {
  const t = useTranslations("dashboard");
  const r = useTranslations("report");
  const tl = useTranslations("timeline");
  const byCat = Object.entries(data.by_category).map(([k, v]) => ({ key: k, name: r(`categories.${k}`), value: v }));
  const byStatus = Object.entries(data.by_status).map(([k, v]) => ({ key: k, name: tl(`status.${k}`), value: v }));
  const stats = [
    { label: t("avgResolution"), value: data.avg_resolution_hours != null ? t("hours", { h: data.avg_resolution_hours }) : "—" },
    { label: t("reopenRate"), value: `${Math.round(data.reopen_rate * 100)}%` },
    { label: t("satisfaction"), value: data.satisfaction != null ? `${data.satisfaction} / 5` : "—" },
    { label: t("breaches"), value: String(data.sla_breaches), alert: data.sla_breaches > 0 },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-3">
            <p className="text-xs text-muted">{s.label}</p>
            <p className={`text-2xl font-bold ${s.alert ? "text-danger" : ""}`}>{s.value}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 font-semibold">{t("byCategory")}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byCat}>
              <CartesianGrid stroke="#26324f" vertical={false} />
              <XAxis dataKey="name" {...AXIS} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis allowDecimals={false} {...AXIS} width={28} />
              <Tooltip {...TOOLTIP} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {byCat.map((d) => <Cell key={d.key} fill={CATEGORY_COLORS[d.key] ?? "#ff9933"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h3 className="mb-2 font-semibold">{t("byStatus")}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={byStatus} layout="vertical">
              <CartesianGrid stroke="#26324f" horizontal={false} />
              <XAxis type="number" allowDecimals={false} {...AXIS} />
              <YAxis type="category" dataKey="name" {...AXIS} width={130} />
              <Tooltip {...TOOLTIP} />
              <Bar dataKey="value" fill="#22a447" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
