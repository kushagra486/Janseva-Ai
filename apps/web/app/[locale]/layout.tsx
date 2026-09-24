import type { Metadata, Viewport } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Noto_Sans_Devanagari } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ConsentBanner } from "@/components/consent-banner";
import { Header } from "@/components/header";
import { SwRegister } from "@/components/sw-register";
import { routing } from "@/i18n/routing";
import "../globals.css";

const noto = Noto_Sans_Devanagari({
  subsets: ["devanagari", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  return {
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    description: `${t("motto")} ${t("mottoSub")}`,
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon.svg", apple: "/icon-192.png" },
  };
}

export const viewport: Viewport = { themeColor: "#0a0f1c", width: "device-width", initialScale: 1 };

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("common");

  return (
    <html lang={locale} className={noto.variable}>
      <body className="font-sans antialiased">
        <NextIntlClientProvider>
          <Header />
          <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 sm:pb-12">{children}</main>
          <footer className="mx-auto max-w-5xl px-4 pb-24 text-xs text-muted sm:pb-8">
            <p>{t("disclaimer")}</p>
            <p className="mt-1">{t("motto")}</p>
          </footer>
          <ConsentBanner />
          <SwRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
