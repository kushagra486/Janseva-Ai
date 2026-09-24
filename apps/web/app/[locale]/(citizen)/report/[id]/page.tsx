import { setRequestLocale } from "next-intl/server";
import { ReportTimeline } from "@/components/report/report-timeline";

export default async function ReportDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <ReportTimeline id={id} />;
}
