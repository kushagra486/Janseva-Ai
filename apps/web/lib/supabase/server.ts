import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled } from "../env";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated Database types
type JansevaClient = SupabaseClient<any, "janseva">;

/**
 * Server Supabase client bound to the request cookies, or null in demo mode. `.from()`/`.rpc()`
 * target the "janseva" schema (see lib/supabase/client.ts for why).
 */
export async function getServerSupabase(): Promise<JansevaClient | null> {
  if (!supabaseEnabled) return null;
  const store = await cookies();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated Database types
  return createServerClient<any, "janseva">(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "janseva" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only; the proxy refreshes them.
        }
      },
    },
  });
}
