import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "@/components/login-form";
import { Card, PageHeader } from "@/components/ui";
import { supabaseEnabled } from "@/lib/env";

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("login");
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title={t("title")} />
      {supabaseEnabled ? <LoginForm /> : <Card>{t("demoNote")}</Card>}
    </div>
  );
}
