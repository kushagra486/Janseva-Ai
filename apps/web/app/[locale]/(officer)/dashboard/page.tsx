import { getTranslations, setRequestLocale } from "next-intl/server";
import { OfficerDashboard } from "@/components/dashboard/officer-dashboard";
import { Card, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");
  const s = await getSession();
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {s.role === "citizen" ? <Card>{t("officerOnly")}</Card> : <OfficerDashboard />}
    </>
  );
}
