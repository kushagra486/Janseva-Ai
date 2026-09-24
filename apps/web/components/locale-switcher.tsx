"use client";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const next = locale === "hi" ? "en" : "hi";
  return (
    <button
      type="button"
      onClick={() =>
        // @ts-expect-error -- params match the current route, which next-intl can't type here
        router.replace({ pathname, params }, { locale: next })
      }
      className="min-h-10 rounded-lg border border-line px-3 text-sm font-semibold"
      aria-label={`Switch language to ${next === "hi" ? "Hindi" : "English"}`}
    >
      {t("language")}
    </button>
  );
}
