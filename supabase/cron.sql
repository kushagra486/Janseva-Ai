-- Schedule the reminder function hourly. Run once in the SQL editor after deploying
-- the function (supabase functions deploy send-reminders). Replace the two placeholders.
-- Store the key in Vault instead of inline if you prefer: select vault.create_secret(...).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-reminders-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>',
                                  'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);
