import { getTranslations, setRequestLocale } from "next-intl/server";
import { MyReports } from "@/components/report/my-reports";
import { ReportForm } from "@/components/report/report-form";
import { PageHeader } from "@/components/ui";
import { supabaseEnabled } from "@/lib/env";
import { getSession } from "@/lib/session";

export async function generateMetadata() {
  const t = await getTranslations("report");
  return { title: t("title") };
}

export default async function ReportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("report");
  const s = await getSession();
  return (
    <div className="space-y-8">
      <div>
        <PageHeader title={t("title")} subtitle={t("subtitle")} />
        <ReportForm uploadAs={supabaseEnabled && !s.demo ? s.userId : null} />
      </div>
      <section>
        <h2 className="mb-3 text-xl font-semibold">{t("mine")}</h2>
        <MyReports />
      </section>
    </div>
  );
}
