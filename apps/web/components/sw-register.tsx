"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/** Registers the service worker (offline pages, push) and shows an offline notice. */
export function SwRegister() {
  const t = useTranslations("common");
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[1200] bg-warn px-4 py-2 text-center text-sm font-medium text-black">
      {t("offline")}
    </div>
  );
}
