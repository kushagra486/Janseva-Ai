"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseEnabled } from "../env";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated Database types
type JansevaClient = SupabaseClient<any, "janseva">;

let client: JansevaClient | null = null;

/**
 * Browser Supabase client, or null in demo mode. `.from()`/`.rpc()` target the "janseva"
 * schema (see supabase/migrations) rather than PostgREST's default "public" — this project's
 * database may hold other apps' tables under "public" too. `.auth.*` and `.storage.*` are
 * unaffected by this option; they always use their own schema/namespace.
 */
export function getBrowserSupabase(): JansevaClient | null {
  if (!supabaseEnabled) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated Database types
  client ??= createBrowserClient<any, "janseva">(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "janseva" },
  });
  return client;
}
