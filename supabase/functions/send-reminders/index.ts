// Sends deadline reminders 7 days, 2 days and on the due date (per deadline.reminder_days).
// Runs hourly via pg_cron (see supabase/cron.sql) and is idempotent per day thanks to
// deadlines.last_reminded_on.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (provided by Supabase), RESEND_API_KEY,
// REMINDER_FROM_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, APP_URL.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

type Deadline = {
  id: string;
  user_id: string;
  title: string;
  due_date: string;
  reminder_days: number[];
  channels: string[];
  last_reminded_on: string | null;
};

const env = (k: string) => Deno.env.get(k) ?? "";
// .from() targets the "janseva" schema, not PostgREST's default "public" — this project's
// database may hold other apps' tables under "public" too.
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  db: { schema: "janseva" },
});
const APP_URL = env("APP_URL") || "https://janseva.example";

if (env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY")) {
  webpush.setVapidDetails(
    env("VAPID_SUBJECT") || "mailto:admin@janseva.example",
    env("VAPID_PUBLIC_KEY"),
    env("VAPID_PRIVATE_KEY"),
  );
}

// Dates are compared in India time so "due today" means today in Lucknow.
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function message(d: Deadline, daysLeft: number) {
  const when = daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
  const whenHi = daysLeft === 0 ? "आज" : `${daysLeft} दिन में`;
  return {
    title: `JANSEVA: ${d.title}`,
    body: `Due ${when} (${d.due_date}). अंतिम तिथि ${whenHi}।`,
    url: `${APP_URL}/hi/deadlines`,
  };
}

async function sendEmail(to: string, msg: ReturnType<typeof message>) {
  if (!env("RESEND_API_KEY")) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env("REMINDER_FROM_EMAIL") || "JANSEVA <reminders@janseva.example>",
      to,
      subject: msg.title,
      text: `${msg.body}\n\n${msg.url}\n\nThis is guidance, not legal advice. Check the original notice.`,
    }),
  });
  return r.ok;
}

async function sendPush(userId: string, msg: ReturnType<typeof message>) {
  if (!env("VAPID_PRIVATE_KEY")) return 0;
  const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(msg),
      );
      sent++;
    } catch (e) {
      // 404/410: the browser dropped the subscription.
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`) {
    return new Response("forbidden", { status: 403 });
  }
  const today = istToday();
  const horizon = new Date(Date.parse(today) + 8 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("deadlines")
    .select("id,user_id,title,due_date,reminder_days,channels,last_reminded_on")
    .eq("status", "active")
    .gte("due_date", today)
    .lte("due_date", horizon);
  if (error) return new Response(error.message, { status: 500 });

  let reminded = 0;
  for (const d of (data ?? []) as Deadline[]) {
    const daysLeft = daysBetween(today, d.due_date);
    if (!d.reminder_days.includes(daysLeft) || d.last_reminded_on === today) continue;
    const msg = message(d, daysLeft);
    if (d.channels.includes("push")) await sendPush(d.user_id, msg);
    if (d.channels.includes("email")) {
      const { data: u } = await supabase.auth.admin.getUserById(d.user_id);
      if (u?.user?.email) await sendEmail(u.user.email, msg);
    }
    await supabase.from("deadlines").update({ last_reminded_on: today }).eq("id", d.id);
    reminded++;
  }
  return Response.json({ today, checked: data?.length ?? 0, reminded });
});
