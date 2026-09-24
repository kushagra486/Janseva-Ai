// Saves a Web Push subscription for the signed-in user. The send-reminders Edge Function
// reads push_subscriptions to deliver reminders.
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";

const Subscription = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  if (!supabase) return Response.json({ detail: "Push needs Supabase" }, { status: 501 });
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return Response.json({ detail: "Sign in required" }, { status: 401 });
  const parsed = Subscription.safeParse(await req.json());
  if (!parsed.success) return Response.json({ detail: "Invalid subscription" }, { status: 422 });
  const { endpoint, keys } = parsed.data;
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth, user_id: data.claims.sub }, { onConflict: "endpoint" });
  if (error) return Response.json({ detail: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
