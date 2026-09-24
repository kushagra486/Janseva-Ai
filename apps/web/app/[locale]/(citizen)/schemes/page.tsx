import { getTranslations, setRequestLocale } from "next-intl/server";
import { SchemeQuiz } from "@/components/schemes/scheme-quiz";
import { PageHeader } from "@/components/ui";

export async function generateMetadata() {
  const t = await getTranslations("schemes");
  return { title: t("title") };
}

export default async function SchemesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("schemes");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <SchemeQuiz />
    </>
  );
}
