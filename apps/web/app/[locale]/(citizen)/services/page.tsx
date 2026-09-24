import { getTranslations, setRequestLocale } from "next-intl/server";
import { ServiceChat } from "@/components/chat/service-chat";
import { PageHeader } from "@/components/ui";

export async function generateMetadata() {
  const t = await getTranslations("services");
  return { title: t("title") };
}

export default async function ServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("services");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <ServiceChat initialQuestion={q} />
    </>
  );
}
