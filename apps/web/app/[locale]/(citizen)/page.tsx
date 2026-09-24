import { CalendarClock, FileSearch, Megaphone, MessageCircleQuestion, Sparkles } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const c = await getTranslations("common");

  const sahayak = [
    { href: "/decode", title: t("decodeTitle"), body: t("decodeBody"), icon: FileSearch, primary: true },
    { href: "/services", title: t("askTitle"), body: t("askBody"), icon: MessageCircleQuestion },
    { href: "/schemes", title: t("schemesTitle"), body: t("schemesBody"), icon: Sparkles },
    { href: "/deadlines", title: t("deadlinesTitle"), body: t("deadlinesBody"), icon: CalendarClock },
  ];

  return (
    <div className="space-y-8">
      <section className="pt-4">
        <p className="text-3xl font-bold leading-snug sm:text-4xl">{c("motto")}</p>
        <p className="mt-1 text-lg text-muted">{c("mottoSub")}</p>
        <p className="mt-3 text-saffron">{t("tagline")}</p>
      </section>

      <section aria-labelledby="sahayak">
        <h2 id="sahayak" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{t("sahayak")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {sahayak.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className={`group flex gap-4 rounded-2xl border p-4 transition hover:-translate-y-0.5 ${
                s.primary ? "border-saffron/60 bg-saffron/10" : "border-line bg-surface/90 hover:border-saffron/40"
              }`}
            >
              <s.icon className={`size-8 shrink-0 ${s.primary ? "text-saffron" : "text-muted group-hover:text-saffron"}`} aria-hidden />
              <span>
                <span className="block text-lg font-semibold">{s.title}</span>
                <span className="text-sm text-muted">{s.body}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="shikayat">
        <h2 id="shikayat" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{t("shikayat")}</h2>
        <Link href="/report" className="flex gap-4 rounded-2xl border border-green/50 bg-green/10 p-4 transition hover:-translate-y-0.5">
          <Megaphone className="size-8 shrink-0 text-green" aria-hidden />
          <span>
            <span className="block text-lg font-semibold">{t("reportTitle")}</span>
            <span className="text-sm text-muted">{t("reportBody")}</span>
          </span>
        </Link>
      </section>
    </div>
  );
}
