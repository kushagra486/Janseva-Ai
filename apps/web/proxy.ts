import { createServerClient } from "@supabase/ssr";
import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled } from "./lib/env";

const intl = createIntlMiddleware(routing);
const DEMO_USER_COOKIE = "janseva_demo_user";

export default async function proxy(request: NextRequest) {
  const response = intl(request);

  if (!supabaseEnabled) {
    // Demo mode: give each browser a stable pseudo-user so "my reports" works without login.
    if (!request.cookies.get(DEMO_USER_COOKIE)) {
      response.cookies.set(DEMO_USER_COOKIE, `demo-${crypto.randomUUID()}`, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    }
    return response;
  }

  // Refresh the Supabase session cookie on every navigation.
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Everything except API routes, Next internals and static files.
  matcher: ["/((?!api|_next|_vercel|sw.js|manifest.webmanifest|.*\\..*).*)"],
};
