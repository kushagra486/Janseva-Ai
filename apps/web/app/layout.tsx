// Root layout is a pass-through; the <html> element lives in app/[locale]/layout.tsx so its
// lang attribute matches the locale.
import type { ReactNode } from "react";

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
