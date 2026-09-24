import { getTranslations, setRequestLocale } from "next-intl/server";
import { KnowledgeConsole } from "@/components/knowledge/knowledge-console";
import { Card, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";

export async function generateMetadata() {
  const t = await getTranslations("knowledge");
  return { title: t("title") };
}

export default async function KnowledgePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("knowledge");
  const s = await getSession();
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {s.role === "admin" ? <KnowledgeConsole /> : <Card>{t("adminOnly")}</Card>}
    </>
  );
}
