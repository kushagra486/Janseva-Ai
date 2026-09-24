import { BookOpen, CalendarClock, FileSearch, Home, LayoutDashboard, Megaphone, MessageCircleQuestion, Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSession } from "@/lib/session";
import { HealthBadge } from "./health-badge";
import { LocaleSwitcher } from "./locale-switcher";
import { RoleSwitcher } from "./role-switcher";
import { SignOutButton } from "./sign-out-button";

export async function Header() {
  const t = await getTranslations();
  const s = await getSession();
  const citizen = [
    { href: "/", label: t("nav.home"), icon: Home },
    { href: "/decode", label: t("nav.decode"), icon: FileSearch },
    { href: "/services", label: t("nav.services"), icon: MessageCircleQuestion },
    { href: "/schemes", label: t("nav.schemes"), icon: Sparkles },
    { href: "/report", label: t("nav.report"), icon: Megaphone },
    { href: "/deadlines", label: t("nav.deadlines"), icon: CalendarClock },
  ] as const;
  const staff = [
    ...(s.role !== "citizen" ? [{ href: "/dashboard", label: t("nav.dashboard"), icon: LayoutDashboard }] : []),
    ...(s.role === "admin" ? [{ href: "/knowledge", label: t("nav.knowledge"), icon: BookOpen }] : []),
  ];

  return (
    <>
      <header className="sticky top-0 z-[1000] border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-saffron to-green text-lg text-white">ज</span>
            <span className="leading-tight">
              {t("common.appName")}
              <span className="block text-[11px] font-normal text-muted">{t("common.motto")}</span>
            </span>
          </Link>
          <nav className="ml-4 hidden gap-1 lg:flex" aria-label="Main">
            {[...citizen.slice(1), ...staff].map((n) => (
              <Link key={n.href} href={n.href} className="rounded-lg px-2.5 py-2 text-sm text-muted hover:bg-surface-2 hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <HealthBadge />
            {s.demo ? (
              <RoleSwitcher role={s.role} />
            ) : s.userId ? (
              <SignOutButton label={t("common.signOut")} />
            ) : (
              <Link href="/login" className="rounded-lg border border-line px-3 py-2 text-sm">
                {t("common.signIn")}
              </Link>
            )}
            <LocaleSwitcher />
          </div>
        </div>
        {staff.length > 0 && (
          <nav className="flex gap-1 overflow-x-auto border-t border-line px-4 py-1.5 lg:hidden" aria-label="Staff">
            {staff.map((n) => (
              <Link key={n.href} href={n.href} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-saffron">
                <n.icon className="size-4" aria-hidden />
                {n.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      {/* Bottom tab bar on phones: big targets, icons plus labels. */}
      <nav aria-label="Citizen" className="fixed inset-x-0 bottom-0 z-[1000] grid grid-cols-6 border-t border-line bg-bg/95 backdrop-blur lg:hidden">
        {citizen.map((n) => (
          <Link key={n.href} href={n.href} className="flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] text-muted hover:text-ink">
            <n.icon className="size-5" aria-hidden />
            <span className="truncate">{n.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
