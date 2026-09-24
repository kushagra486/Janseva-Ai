import "server-only";
import { cookies } from "next/headers";
import { supabaseEnabled } from "./env";
import { getServerSupabase } from "./supabase/server";

export type Role = "citizen" | "officer" | "admin";
export type Session = {
  userId: string | null;
  role: Role;
  email?: string;
  demo: boolean;
  token?: string;
};

export const DEMO_ROLE_COOKIE = "janseva_demo_role";
export const DEMO_USER_COOKIE = "janseva_demo_user";
const ROLES: Role[] = ["citizen", "officer", "admin"];

/** Who is making this request. In demo mode the role comes from the role-switcher cookie. */
export async function getSession(): Promise<Session> {
  if (!supabaseEnabled) {
    const c = await cookies();
    const role = c.get(DEMO_ROLE_COOKIE)?.value as Role | undefined;
    return {
      userId: c.get(DEMO_USER_COOKIE)?.value ?? null,
      role: role && ROLES.includes(role) ? role : "citizen",
      demo: true,
    };
  }
  const supabase = (await getServerSupabase())!;
  // getClaims verifies the JWT; getSession only reads the cookie, so it is used for the token.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return { userId: null, role: "citizen", demo: false };
  const { data: s } = await supabase.auth.getSession();
  // Namespaced under app_metadata.janseva (not a top-level "role" key) so it can never
  // collide with a claim another app on this Supabase project sets — see the sync_role_claims
  // trigger in supabase/migrations.
  const janseva = (claims.app_metadata as { janseva?: { role?: Role; ward?: string } } | undefined)?.janseva;
  const role = janseva?.role;
  return {
    userId: claims.sub,
    role: role && ROLES.includes(role) ? role : "citizen",
    email: claims.email as string | undefined,
    demo: false,
    token: s.session?.access_token,
  };
}
