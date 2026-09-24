-- Row-level security.

alter table public.wards               enable row level security;
alter table public.departments         enable row level security;
alter table public.profiles            enable row level security;
alter table public.notices             enable row level security;
alter table public.deadlines           enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.sources             enable row level security;
alter table public.doc_chunks          enable row level security;
alter table public.services            enable row level security;
alter table public.schemes             enable row level security;
alter table public.clusters            enable row level security;
alter table public.reports             enable row level security;
alter table public.report_events       enable row level security;
alter table public.action_plans        enable row level security;
alter table public.report_feedback     enable row level security;

-- Public reference data and knowledge base: anyone may read, admins write.
create policy "read wards" on public.wards for select using (true);
create policy "read departments" on public.departments for select using (true);
create policy "read sources" on public.sources for select using (true);
create policy "read chunks" on public.doc_chunks for select using (true);
create policy "read services" on public.services for select using (true);
create policy "read schemes" on public.schemes for select using (true);

create policy "admin writes wards" on public.wards for all
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "admin writes departments" on public.departments for all
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "admin writes sources" on public.sources for all
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "admin writes chunks" on public.doc_chunks for all
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "admin writes services" on public.services for all
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');
create policy "admin writes schemes" on public.schemes for all
  using (public.app_role() = 'admin') with check (public.app_role() = 'admin');

-- Profiles: your own; officers and admins can read all (to show names on the queue).
create policy "own profile" on public.profiles for select
  using (id = auth.uid() or public.app_role() in ('officer', 'admin'));
create policy "update own profile" on public.profiles for update
  using (id = auth.uid() or public.app_role() = 'admin');

-- Personal Sahayak data: owner only.
create policy "own notices" on public.notices for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own deadlines" on public.deadlines for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own push subscriptions" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Reports: citizens see and file their own; officers see their ward; admins see all.
create policy "file own report" on public.reports for insert
  with check (user_id = auth.uid());
create policy "see reports" on public.reports for select using (
  user_id = auth.uid()
  or public.app_role() = 'admin'
  or (public.app_role() = 'officer' and (ward = public.app_ward() or public.app_ward() is null)));
create policy "officer updates reports" on public.reports for update using (
  public.app_role() = 'admin'
  or (public.app_role() = 'officer' and (ward = public.app_ward() or public.app_ward() is null)));

-- Clusters are the public map of issues (no personal data); officers manage their ward.
create policy "see clusters" on public.clusters for select to authenticated using (true);
create policy "officer manages clusters" on public.clusters for update using (
  public.app_role() = 'admin'
  or (public.app_role() = 'officer' and (ward = public.app_ward() or public.app_ward() is null)));

-- Timeline: visible to whoever can see the report. Inserts only (table is append-only).
create policy "see events" on public.report_events for select using (
  exists (select 1 from public.reports r where r.id = report_id));
create policy "officer adds events" on public.report_events for insert
  with check (public.app_role() in ('officer', 'admin'));

-- Plans: officers and admins only.
create policy "officer plans" on public.action_plans for all
  using (public.app_role() in ('officer', 'admin'))
  with check (public.app_role() in ('officer', 'admin'));

create policy "own feedback" on public.report_feedback for insert
  with check (user_id = auth.uid());
create policy "see feedback" on public.report_feedback for select
  using (user_id = auth.uid() or public.app_role() in ('officer', 'admin'));

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public) values
  ('notices', 'notices', false),
  ('reports', 'reports', false),
  ('sources', 'sources', false)
on conflict (id) do nothing;

-- Files live under "<user_id>/..." so the first folder identifies the owner.
create policy "own notice files" on storage.objects for all
  using (bucket_id = 'notices' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'notices' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "own report photos" on storage.objects for all
  using (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "officers read report photos" on storage.objects for select
  using (bucket_id = 'reports' and public.app_role() in ('officer', 'admin'));

create policy "admins manage source files" on storage.objects for all
  using (bucket_id = 'sources' and public.app_role() = 'admin')
  with check (bucket_id = 'sources' and public.app_role() = 'admin');
