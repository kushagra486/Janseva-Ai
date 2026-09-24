-- Expose the janseva schema through PostgREST, and grant it the privileges a newly created
-- schema doesn't get automatically (unlike "public", which Supabase pre-grants by default).
--
-- The db_schemas list is additive: it is set to whatever it already was (public and
-- graphql_public, Supabase's defaults, confirmed empty/unset on this project before this
-- migration) plus janseva. If another app on this project has already customised this list,
-- update the line below to include its schema too before applying.

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, janseva';
notify pgrst, 'reload config';

grant usage on schema janseva to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema janseva to anon, authenticated;
grant select, insert, update, delete on all tables in schema janseva to service_role;
alter default privileges in schema janseva
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

grant execute on all functions in schema janseva to anon, authenticated, service_role;
alter default privileges in schema janseva
  grant execute on functions to anon, authenticated, service_role;

-- Row-level security (migration 2) is what actually restricts anon/authenticated; the grants
-- above only make the schema and tables visible to PostgREST at all. set_role stays admin
-- (service-role) only, same as when it was public.set_role.
revoke execute on function janseva.set_role(text, text, text) from public, anon, authenticated;
