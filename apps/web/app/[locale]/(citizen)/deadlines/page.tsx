import type { Deadline } from "@janseva/shared";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DeadlineList } from "@/components/deadlines/deadline-list";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { getServerSupabase } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("deadlines");
  return { title: t("title") };
}

export default async function DeadlinesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("deadlines");
  const s = await getSession();
  let server: Deadline[] = [];
  const supabase = await getServerSupabase();
  if (supabase && s.userId) {
    const { data } = await supabase.from("deadlines").select("id,title,due_date,status").neq("status", "dismissed").order("due_date");
    server = (data ?? []) as Deadline[];
  }
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <DeadlineList server={server} signedIn={Boolean(s.userId && !s.demo)} />
    </>
  );
}
