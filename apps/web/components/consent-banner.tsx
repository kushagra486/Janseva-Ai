"use client";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { acceptConsent } from "@/app/actions";
import { Link } from "@/i18n/navigation";
import { Button } from "./ui";

const KEY = "janseva.consent.v1";
const EVENT = "janseva-consent";

function accepted(): boolean {
  try {
    return Boolean(window.localStorage.getItem(KEY));
  } catch {
    return false;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function ConsentBanner() {
  const t = useTranslations("consent");
  // Server render assumes accepted, so the banner never flashes for returning users.
  const show = !useSyncExternalStore(subscribe, accepted, () => true);
  if (!show) return null;
  return (
    <div role="dialog" aria-labelledby="consent-title" className="fixed inset-x-3 bottom-20 z-[1100] mx-auto max-w-xl rounded-2xl border border-saffron/40 bg-surface p-4 shadow-2xl sm:bottom-6">
      <h2 id="consent-title" className="font-semibold">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("body")}</p>
      <div className="mt-3 flex items-center gap-3">
        <Button
          onClick={async () => {
            try {
              window.localStorage.setItem(KEY, new Date().toISOString());
            } catch {}
            window.dispatchEvent(new Event(EVENT));
            await acceptConsent();
          }}
        >
          {t("accept")}
        </Button>
        <Link href="/privacy" className="text-sm text-saffron underline">
          {t("more")}
        </Link>
      </div>
    </div>
  );
}
