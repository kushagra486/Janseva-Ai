"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setDemoRole } from "@/app/actions";

type Role = "citizen" | "officer" | "admin";

/** Demo mode only: switch between citizen, officer and admin views without accounts. */
export function RoleSwitcher({ role }: { role: Role }) {
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <span className="hidden sm:inline">{t("demoMode")} · {t("viewAs")}</span>
      <select
        value={role}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await setDemoRole(e.target.value as Role);
            router.refresh();
          })
        }
        className="min-h-10 rounded-lg border border-saffron/50 bg-surface-2 px-2 text-sm text-ink"
      >
        {(["citizen", "officer", "admin"] as const).map((r) => (
          <option key={r} value={r}>
            {t(`roles.${r}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
