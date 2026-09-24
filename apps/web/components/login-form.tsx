"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { Button, Card, ErrorBox, inputClass, Label } from "./ui";

/** Email one-time code sign-in (phone OTP can replace this later). */
export function LoginForm() {
  const t = useTranslations("login");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = getBrowserSupabase()!;

  async function send() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    setBusy(false);
    if (e) setError(e.message);
    else setSent(true);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setBusy(false);
    if (e) setError(e.message);
    else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} disabled={sent} />
      </div>
      {!sent ? (
        <Button className="w-full" onClick={send} disabled={busy || !email.includes("@")}>
          {t("sendCode")}
        </Button>
      ) : (
        <>
          <p className="text-sm text-muted">{t("sent", { email })}</p>
          <div>
            <Label htmlFor="code">{t("code")}</Label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${inputClass} text-center text-2xl tracking-widest`} />
          </div>
          <Button className="w-full" onClick={verify} disabled={busy || code.length < 6}>
            {t("verify")}
          </Button>
        </>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </Card>
  );
}
