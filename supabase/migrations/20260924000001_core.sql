-- JANSEVA AI core schema.
-- Every table has row-level security. Citizens see their own rows, officers see their ward,
-- admins see everything. The AI service uses the service-role key and enforces roles itself.

create extension if not exists vector;
create extension if not exists postgis;

-- ---------------------------------------------------------------- reference data

create table public.wards (
  id   text primary key,
  name text not null,
  lat  double precision not null,
  lng  double precision not null
);

create table public.departments (
  id         text primary key,
  name       text not null,
  name_hi    text,
  categories text[] not null,
  sla_hours  int not null check (sla_hours > 0)
);

-- ---------------------------------------------------------------- people

create table public.profiles (
  id             uuid primary key references auth.users on delete cascade,
  role           text not null default 'citizen' check (role in ('citizen', 'officer', 'admin')),
  preferred_lang text not null default 'hi' check (preferred_lang in ('hi', 'en')),
  ward           text references public.wards,
  full_name      text,
  consent_at     timestamptz,           -- DPDP Act 2023: when the user accepted the notice
  created_at     timestamptz not null default now()
);

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon')
$$;

create or replace function public.app_ward() returns text
language sql stable security definer set search_path = public as $$
  select ward from public.profiles where id = auth.uid()
$$;

-- New auth user -> citizen profile.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins (or the service role, where auth.uid() is null) may change role or ward.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.ward is distinct from old.ward)
     and auth.uid() is not null and public.app_role() <> 'admin' then
    raise exception 'only an admin can change role or ward';
  end if;
  return new;
end $$;

create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Mirror role and ward into the JWT (app_metadata) so the AI service can authorise requests.
create or replace function public.sync_role_claims() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('role', new.role, 'ward', new.ward)
   where id = new.id;
  return new;
end $$;

create trigger sync_role_claims after insert or update of role, ward on public.profiles
  for each row execute function public.sync_role_claims();

-- Promote a user by email. Run from the SQL editor (service role); not exposed to clients.
create or replace function public.set_role(p_email text, p_role text, p_ward text default null)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  update public.profiles p set role = p_role, ward = p_ward
    from auth.users u where u.id = p.id and u.email = p_email;
  if not found then raise exception 'no user with email %', p_email; end if;
end $$;
revoke execute on function public.set_role(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- Sahayak

create table public.notices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  image_path  text,                      -- private bucket "notices", path "<user_id>/<file>"
  ocr_text    text,                      -- stored PII-masked
  fields      jsonb not null default '{}',
  explanation jsonb,
  confidence  real,
  language    text not null default 'hi',
  created_at  timestamptz not null default now()
);
create index on public.notices (user_id, created_at desc);

create table public.deadlines (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade default auth.uid(),
  notice_id        uuid references public.notices on delete set null,
  title            text not null,
  due_date         date not null,
  reminder_days    int[] not null default '{7,2,0}',
  channels         text[] not null default '{push,email}',
  status           text not null default 'active' check (status in ('active', 'done', 'dismissed')),
  last_reminded_on date,
  created_at       timestamptz not null default now()
);
create index on public.deadlines (status, due_date);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- knowledge base

create table public.sources (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title      text not null,
  url        text,
  kind       text not null default 'service',
  language   text not null default 'en',
  content    text not null,
  created_at timestamptz not null default now()
);

create table public.doc_chunks (
  id        uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources on delete cascade,
  content   text not null,
  ordinal   int not null,
  embedding vector(1024)
);
create index on public.doc_chunks using hnsw (embedding vector_cosine_ops);

create table public.services (
  id         text primary key,
  title      text not null,
  title_hi   text,
  department text,
  source_id  uuid references public.sources on delete set null
);

create table public.schemes (
  id         text primary key,
  name       text not null,
  name_hi    text,
  level      text,
  rules      jsonb not null default '{}',
  documents  jsonb not null default '[]',
  apply_url  text,
  source_id  uuid references public.sources on delete set null
);

create or replace function public.match_doc_chunks(query_embedding vector(1024), match_count int default 5)
returns table (id uuid, source_id uuid, content text, similarity float)
language sql stable as $$
  select c.id, c.source_id, c.content, 1 - (c.embedding <=> query_embedding) as similarity
    from public.doc_chunks c
   where c.embedding is not null
   order by c.embedding <=> query_embedding
   limit match_count
$$;

-- ---------------------------------------------------------------- Shikayat / Prashasan

create table public.clusters (
  id           uuid primary key default gen_random_uuid(),
  category     text not null check (category in ('waste','water_drainage','roads','streetlights','public_infra')),
  title        text not null,
  lat          double precision not null,
  lng          double precision not null,
  centroid     geography(point, 4326)
               generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  ward         text references public.wards,
  report_count int not null default 1,
  severity     int not null check (severity between 1 and 5),
  priority     real not null default 0,
  status       text not null,
  embedding    vector(1024),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.clusters using gist (centroid);
create index on public.clusters (ward, status);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete set null,
  text        text not null,             -- stored PII-masked
  category    text not null,
  severity    int not null check (severity between 1 and 5),
  lat         double precision not null,
  lng         double precision not null,
  location    geography(point, 4326)
              generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  address     text,
  ward        text references public.wards,
  status      text not null check (status in ('submitted','triaged','clustered','planned',
                'awaiting_approval','assigned','in_progress','resolved','verified','reopened','rejected')),
  cluster_id  uuid references public.clusters on delete set null,
  photo_path  text,                      -- private bucket "reports"
  language    text not null default 'hi',
  flags       text[] not null default '{}',
  embedding   vector(1024),
  created_at  timestamptz not null default now()
);
create index on public.reports (user_id, created_at desc);
create index on public.reports (cluster_id);

-- Append-only audit trail of every status change.
create table public.report_events (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports on delete cascade,
  status     text not null,
  note       text not null,
  actor      text not null,
  created_at timestamptz not null default now()
);
create index on public.report_events (report_id, created_at);

create or replace function public.forbid_change() returns trigger language plpgsql as $$
begin raise exception 'report_events is append-only'; end $$;
create trigger report_events_append_only before update or delete on public.report_events
  for each row execute function public.forbid_change();

create table public.action_plans (
  id            uuid primary key default gen_random_uuid(),
  cluster_id    uuid not null references public.clusters on delete cascade,
  department_id text not null references public.departments,
  steps         jsonb not null,
  sla_hours     int not null,
  due_at        timestamptz,
  status        text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  officer_note  text,
  drafted_by    text not null,
  decided_by    uuid references auth.users,
  created_at    timestamptz not null default now()
);
create index on public.action_plans (cluster_id, created_at desc);

create table public.report_feedback (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.reports on delete cascade,
  user_id    uuid references auth.users on delete set null,
  rating     int check (rating between 1 and 5),
  confirmed  boolean not null,
  comment    text,
  created_at timestamptz not null default now()
);

create or replace function public.nearby_open_clusters(
  p_lat double precision, p_lng double precision, p_radius_m double precision, p_category text)
returns table (id uuid, distance_m double precision, embedding text)
language sql stable as $$
  select c.id,
         st_distance(c.centroid, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography),
         c.embedding::text
    from public.clusters c
   where c.category = p_category
     and c.status in ('submitted','triaged','clustered','planned','awaiting_approval',
                      'assigned','in_progress','reopened')
     and st_dwithin(c.centroid, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_m)
   order by 2
$$;

-- Status changes on reports and clusters are pushed to clients.
alter publication supabase_realtime add table public.report_events, public.clusters;
