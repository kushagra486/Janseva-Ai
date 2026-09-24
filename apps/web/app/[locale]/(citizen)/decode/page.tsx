import { getTranslations, setRequestLocale } from "next-intl/server";
import { NoticeDecoder } from "@/components/decoder/notice-decoder";
import { PageHeader } from "@/components/ui";
import { supabaseEnabled } from "@/lib/env";
import { getSession } from "@/lib/session";

export async function generateMetadata() {
  const t = await getTranslations("decode");
  return { title: t("title") };
}

export default async function DecodePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("decode");
  const s = await getSession();
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <NoticeDecoder uploadAs={supabaseEnabled && s.userId && !s.demo ? s.userId : null} />
    </>
  );
}
