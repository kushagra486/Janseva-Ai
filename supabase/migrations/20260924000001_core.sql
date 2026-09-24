-- JANSEVA AI core schema.
--
-- Everything JANSEVA owns lives in its own `janseva` schema, not `public`. This project's
-- database may be shared with other, unrelated apps (each in their own schema); putting
-- JANSEVA's tables, functions and triggers in a dedicated schema means their names can never
-- collide with another app's, and the whole feature can be inspected or dropped
-- (`drop schema janseva cascade`) without touching anything else in the database.
--
-- The one thing that is *not* schema-scoped is Supabase Auth (`auth.users` is shared by every
-- app in the project) and Storage buckets (bucket ids are a single global namespace). Both are
-- handled below: the auth trigger only ever touches `janseva.profiles`, and bucket ids are
-- prefixed `janseva-*` so they cannot collide with another app's buckets.
--
-- Every table has row-level security. Citizens see their own rows, officers see their ward,
-- admins see everything. The AI service uses the service-role key and enforces roles itself.

-- Installed into "extensions" (this project's existing convention — pgcrypto already lives
-- there), never into "public", so JANSEVA adds nothing to the shared public schema at all.
create extension if not exists vector with schema extensions;
create extension if not exists postgis with schema extensions;

create schema if not exists janseva;

-- Scoped to this migration's own session only (a plain SET, not a stored setting on any
-- role): lets the unqualified st_setsrid/st_makepoint calls in the generated columns below
-- resolve while this script runs.
set search_path = public, extensions;

-- ---------------------------------------------------------------- reference data

create table janseva.wards (
  id   text primary key,
  name text not null,
  lat  double precision not null,
  lng  double precision not null
);

create table janseva.departments (
  id         text primary key,
  name       text not null,
  name_hi    text,
  categories text[] not null,
  sla_hours  int not null check (sla_hours > 0)
);

-- ---------------------------------------------------------------- people

create table janseva.profiles (
  id             uuid primary key references auth.users on delete cascade,
  role           text not null default 'citizen' check (role in ('citizen', 'officer', 'admin')),
  preferred_lang text not null default 'hi' check (preferred_lang in ('hi', 'en')),
  ward           text references janseva.wards,
  full_name      text,
  consent_at     timestamptz,           -- DPDP Act 2023: when the user accepted the notice
  created_at     timestamptz not null default now()
);

-- All SECURITY DEFINER functions below set search_path = '' and fully qualify every
-- identifier, so they cannot be hijacked by a same-named object placed earlier on some other
-- search_path (a real risk on a database shared with other apps and schemas).

create or replace function janseva.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select role from janseva.profiles where id = auth.uid()), 'anon')
$$;

create or replace function janseva.app_ward() returns text
language sql stable security definer set search_path = '' as $$
  select ward from janseva.profiles where id = auth.uid()
$$;

-- New auth user -> citizen profile. auth.users is shared with any other app in this project,
-- so this only ever inserts into janseva.profiles; it never reads or writes another app's data.
create or replace function janseva.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into janseva.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function janseva.handle_new_user();

-- Only admins (or the service role, where auth.uid() is null) may change role or ward.
create or replace function janseva.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.role is distinct from old.role or new.ward is distinct from old.ward)
     and auth.uid() is not null and janseva.app_role() <> 'admin' then
    raise exception 'only an admin can change role or ward';
  end if;
  return new;
end $$;

create trigger guard_profile_update before update on janseva.profiles
  for each row execute function janseva.guard_profile_update();

-- Mirror role and ward into the JWT so the AI service can authorise requests without a DB
-- round trip. Written under app_metadata.janseva (never top-level `role`/`ward` keys) so this
-- can never collide with or overwrite a claim another app on the same project sets.
create or replace function janseva.sync_role_claims() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('janseva',
                                jsonb_build_object('role', new.role, 'ward', new.ward))
   where id = new.id;
  return new;
end $$;

create trigger sync_role_claims after insert or update of role, ward on janseva.profiles
  for each row execute function janseva.sync_role_claims();

-- Promote a user by email. Run from the SQL editor (service role); not exposed to clients.
create or replace function janseva.set_role(p_email text, p_role text, p_ward text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update janseva.profiles p set role = p_role, ward = p_ward
    from auth.users u where u.id = p.id and u.email = p_email;
  if not found then raise exception 'no user with email %', p_email; end if;
end $$;
revoke execute on function janseva.set_role(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- Sahayak

create table janseva.notices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade default auth.uid(),
  image_path  text,                      -- private bucket "janseva-notices", path "<user_id>/<file>"
  ocr_text    text,                      -- stored PII-masked
  fields      jsonb not null default '{}',
  explanation jsonb,
  confidence  real,
  language    text not null default 'hi',
  created_at  timestamptz not null default now()
);
create index on janseva.notices (user_id, created_at desc);

create table janseva.deadlines (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users on delete cascade default auth.uid(),
  notice_id        uuid references janseva.notices on delete set null,
  title            text not null,
  due_date         date not null,
  reminder_days    int[] not null default '{7,2,0}',
  channels         text[] not null default '{push,email}',
  status           text not null default 'active' check (status in ('active', 'done', 'dismissed')),
  last_reminded_on date,
  created_at       timestamptz not null default now()
);
create index on janseva.deadlines (status, due_date);

create table janseva.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade default auth.uid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- knowledge base

create table janseva.sources (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title      text not null,
  url        text,
  kind       text not null default 'service',
  language   text not null default 'en',
  content    text not null,
  created_at timestamptz not null default now()
);

create table janseva.doc_chunks (
  id        uuid primary key default gen_random_uuid(),
  source_id uuid not null references janseva.sources on delete cascade,
  content   text not null,
  ordinal   int not null,
  embedding vector(1024)
);
create index on janseva.doc_chunks using hnsw (embedding vector_cosine_ops);

create table janseva.services (
  id         text primary key,
  title      text not null,
  title_hi   text,
  department text,
  source_id  uuid references janseva.sources on delete set null
);

create table janseva.schemes (
  id         text primary key,
  name       text not null,
  name_hi    text,
  level      text,
  rules      jsonb not null default '{}',
  documents  jsonb not null default '[]',
  apply_url  text,
  source_id  uuid references janseva.sources on delete set null
);

-- search_path is pinned to (janseva, extensions) rather than left empty: the <=> operator
-- comes from pgvector in "extensions". Both schemas are fixed and fully under this
-- migration's control, which is what actually defends against search-path hijacking — an
-- attacker would need write access to one of these two schemas, not just any schema on a
-- mutable default path.
create or replace function janseva.match_doc_chunks(query_embedding vector(1024), match_count int default 5)
returns table (id uuid, source_id uuid, content text, similarity float)
language sql stable security definer set search_path = janseva, extensions as $$
  select c.id, c.source_id, c.content, 1 - (c.embedding <=> query_embedding) as similarity
    from janseva.doc_chunks c
   where c.embedding is not null
   order by c.embedding <=> query_embedding
   limit match_count
$$;

-- ---------------------------------------------------------------- Shikayat / Prashasan

create table janseva.clusters (
  id           uuid primary key default gen_random_uuid(),
  category     text not null check (category in ('waste','water_drainage','roads','streetlights','public_infra')),
  title        text not null,
  lat          double precision not null,
  lng          double precision not null,
  centroid     geography(point, 4326)
               generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  ward         text references janseva.wards,
  report_count int not null default 1,
  severity     int not null check (severity between 1 and 5),
  priority     real not null default 0,
  status       text not null,
  embedding    vector(1024),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on janseva.clusters using gist (centroid);
create index on janseva.clusters (ward, status);

create table janseva.reports (
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
  ward        text references janseva.wards,
  status      text not null check (status in ('submitted','triaged','clustered','planned',
                'awaiting_approval','assigned','in_progress','resolved','verified','reopened','rejected')),
  cluster_id  uuid references janseva.clusters on delete set null,
  photo_path  text,                      -- private bucket "janseva-reports"
  language    text not null default 'hi',
  flags       text[] not null default '{}',
  embedding   vector(1024),
  created_at  timestamptz not null default now()
);
create index on janseva.reports (user_id, created_at desc);
create index on janseva.reports (cluster_id);

-- Append-only audit trail of every status change.
create table janseva.report_events (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references janseva.reports on delete cascade,
  status     text not null,
  note       text not null,
  actor      text not null,
  created_at timestamptz not null default now()
);
create index on janseva.report_events (report_id, created_at);

create or replace function janseva.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'report_events is append-only'; end $$;
create trigger report_events_append_only before update or delete on janseva.report_events
  for each row execute function janseva.forbid_change();

create table janseva.action_plans (
  id            uuid primary key default gen_random_uuid(),
  cluster_id    uuid not null references janseva.clusters on delete cascade,
  department_id text not null references janseva.departments,
  steps         jsonb not null,
  sla_hours     int not null,
  due_at        timestamptz,
  status        text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  officer_note  text,
  drafted_by    text not null,
  decided_by    uuid references auth.users,
  created_at    timestamptz not null default now()
);
create index on janseva.action_plans (cluster_id, created_at desc);

create table janseva.report_feedback (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references janseva.reports on delete cascade,
  user_id    uuid references auth.users on delete set null,
  rating     int check (rating between 1 and 5),
  confirmed  boolean not null,
  comment    text,
  created_at timestamptz not null default now()
);

-- Same reasoning as match_doc_chunks: st_setsrid/st_makepoint/st_dwithin/st_distance come
-- from PostGIS in "extensions".
create or replace function janseva.nearby_open_clusters(
  p_lat double precision, p_lng double precision, p_radius_m double precision, p_category text)
returns table (id uuid, distance_m double precision, embedding text)
language sql stable security definer set search_path = janseva, extensions as $$
  select c.id,
         st_distance(c.centroid, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography),
         c.embedding::text
    from janseva.clusters c
   where c.category = p_category
     and c.status in ('submitted','triaged','clustered','planned','awaiting_approval',
                      'assigned','in_progress','reopened')
     and st_dwithin(c.centroid, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_m)
   order by 2
$$;

-- Status changes on reports and clusters are pushed to clients. Additive: does not touch
-- whatever tables another app has already added to this publication.
alter publication supabase_realtime add table janseva.report_events, janseva.clusters;
