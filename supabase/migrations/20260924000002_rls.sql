-- Row-level security, all on the janseva schema.

alter table janseva.wards               enable row level security;
alter table janseva.departments         enable row level security;
alter table janseva.profiles            enable row level security;
alter table janseva.notices             enable row level security;
alter table janseva.deadlines           enable row level security;
alter table janseva.push_subscriptions  enable row level security;
alter table janseva.sources             enable row level security;
alter table janseva.doc_chunks          enable row level security;
alter table janseva.services            enable row level security;
alter table janseva.schemes             enable row level security;
alter table janseva.clusters            enable row level security;
alter table janseva.reports             enable row level security;
alter table janseva.report_events       enable row level security;
alter table janseva.action_plans        enable row level security;
alter table janseva.report_feedback     enable row level security;

-- Public reference data and knowledge base: anyone may read, admins write.
create policy "read wards" on janseva.wards for select using (true);
create policy "read departments" on janseva.departments for select using (true);
create policy "read sources" on janseva.sources for select using (true);
create policy "read chunks" on janseva.doc_chunks for select using (true);
create policy "read services" on janseva.services for select using (true);
create policy "read schemes" on janseva.schemes for select using (true);

create policy "admin writes wards" on janseva.wards for all
  using (janseva.app_role() = 'admin') with check (janseva.app_role() = 'admin');
create policy "admin writes departments" on janseva.departments for all
  using (janseva.app_role() = 'admin') with check (janseva.app_role() = 'admin');
create policy "admin writes sources" on janseva.sources for all
  using (janseva.app_role() = 'admin') with check (janseva.app_role() = 'admin');
create policy "admin writes chunks" on janseva.doc_chunks for all
  using (janseva.app_role() = 'admin') with check (janseva.app_role() = 'admin');
create policy "admin writes services" on janseva.services for all
  using (janseva.app_role() = 'admin') with check (janseva.app_role() = 'admin');
create policy "admin writes schemes" on janseva.schemes for all
  using (janseva.app_role() = 'admin') with check (janseva.app_role() = 'admin');

-- Profiles: your own; officers and admins can read all (to show names on the queue).
create policy "own profile" on janseva.profiles for select
  using (id = (select auth.uid()) or janseva.app_role() in ('officer', 'admin'));
create policy "update own profile" on janseva.profiles for update
  using (id = (select auth.uid()) or janseva.app_role() = 'admin');

-- Personal Sahayak data: owner only.
create policy "own notices" on janseva.notices for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own deadlines" on janseva.deadlines for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own push subscriptions" on janseva.push_subscriptions for all
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Reports: citizens see and file their own; officers see their ward; admins see all.
create policy "file own report" on janseva.reports for insert
  with check (user_id = (select auth.uid()));
create policy "see reports" on janseva.reports for select using (
  user_id = (select auth.uid())
  or janseva.app_role() = 'admin'
  or (janseva.app_role() = 'officer' and (ward = janseva.app_ward() or janseva.app_ward() is null)));
create policy "officer updates reports" on janseva.reports for update using (
  janseva.app_role() = 'admin'
  or (janseva.app_role() = 'officer' and (ward = janseva.app_ward() or janseva.app_ward() is null)));

-- Clusters are the public map of issues (no personal data); officers manage their ward.
create policy "see clusters" on janseva.clusters for select to authenticated using (true);
create policy "officer manages clusters" on janseva.clusters for update using (
  janseva.app_role() = 'admin'
  or (janseva.app_role() = 'officer' and (ward = janseva.app_ward() or janseva.app_ward() is null)));

-- Timeline: visible to whoever can see the report. Inserts only (table is append-only).
create policy "see events" on janseva.report_events for select using (
  exists (select 1 from janseva.reports r where r.id = report_id));
create policy "officer adds events" on janseva.report_events for insert
  with check (janseva.app_role() in ('officer', 'admin'));

-- Plans: officers and admins only.
create policy "officer plans" on janseva.action_plans for all
  using (janseva.app_role() in ('officer', 'admin'))
  with check (janseva.app_role() in ('officer', 'admin'));

create policy "own feedback" on janseva.report_feedback for insert
  with check (user_id = (select auth.uid()));
create policy "see feedback" on janseva.report_feedback for select
  using (user_id = (select auth.uid()) or janseva.app_role() in ('officer', 'admin'));

-- ---------------------------------------------------------------- storage
--
-- Bucket ids are a single global namespace for the whole project (Storage has no schema
-- concept), so every JANSEVA bucket is prefixed "janseva-" and every policy below matches
-- only that prefix. This never touches another app's buckets or its storage.objects policies.

insert into storage.buckets (id, name, public) values
  ('janseva-notices', 'janseva-notices', false),
  ('janseva-reports', 'janseva-reports', false),
  ('janseva-sources', 'janseva-sources', false)
on conflict (id) do nothing;

-- Files live under "<user_id>/..." so the first folder identifies the owner.
create policy "own notice files" on storage.objects for all
  using (bucket_id = 'janseva-notices' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'janseva-notices' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own report photos" on storage.objects for all
  using (bucket_id = 'janseva-reports' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'janseva-reports' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "officers read report photos" on storage.objects for select
  using (bucket_id = 'janseva-reports' and janseva.app_role() in ('officer', 'admin'));

create policy "admins manage source files" on storage.objects for all
  using (bucket_id = 'janseva-sources' and janseva.app_role() = 'admin')
  with check (bucket_id = 'janseva-sources' and janseva.app_role() = 'admin');
