-- Row-level security checks. Run after migrations on the stubbed database.
-- Each block raises an exception (failing CI) if a policy lets the wrong thing through.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.in'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.in'),
  ('00000000-0000-0000-0000-00000000000c', 'officer@test.in');
select janseva.set_role('officer@test.in', 'officer', 'hazratganj');

do $$ begin
  if (select raw_app_meta_data->'janseva'->>'role' from auth.users where email = 'officer@test.in') <> 'officer'
  then raise exception 'role claim not synced to app_metadata.janseva'; end if;
end $$;

insert into janseva.clusters (id, category, title, lat, lng, ward, severity, status) values
  ('10000000-0000-0000-0000-000000000001', 'roads', 'pothole', 26.8506, 80.9462, 'hazratganj', 2, 'awaiting_approval');
insert into janseva.reports (id, user_id, text, category, severity, lat, lng, ward, status, cluster_id) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'a pothole', 'roads', 2, 26.8506, 80.9462, 'hazratganj', 'awaiting_approval', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'b drain', 'water_drainage', 3, 26.8960, 80.9420, 'aliganj', 'awaiting_approval', null);
insert into janseva.report_events (report_id, status, note, actor) values
  ('20000000-0000-0000-0000-00000000000a', 'triaged', 'n', 'test');

do $$ begin
  if (select count(*) from janseva.nearby_open_clusters(26.8506, 80.9462, 150, 'roads')) <> 1
  then raise exception 'nearby_open_clusters missed a cluster'; end if;
  if (select count(*) from janseva.nearby_open_clusters(26.90, 80.99, 150, 'roads')) <> 0
  then raise exception 'nearby_open_clusters matched a far cluster'; end if;
end $$;

-- Citizen A
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  if (select string_agg(text, ',') from janseva.reports) <> 'a pothole'
  then raise exception 'citizen sees reports that are not theirs'; end if;
  if (select count(*) from janseva.report_events) <> 1 then raise exception 'citizen cannot see own timeline'; end if;
  if (select count(*) from janseva.action_plans) <> 0 then raise exception 'citizen can read plans'; end if;
  begin
    insert into janseva.reports (user_id, text, category, severity, lat, lng, status)
    values ('00000000-0000-0000-0000-00000000000b', 'x', 'roads', 1, 1, 1, 'submitted');
    raise exception 'citizen filed a report as someone else';
  exception when insufficient_privilege then null; end;
  begin
    update janseva.profiles set role = 'admin' where id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'citizen promoted themselves';
  exception when raise_exception then
    if sqlerrm like 'citizen promoted%' then raise; end if;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('janseva-notices', '00000000-0000-0000-0000-00000000000b/x.jpg');
    raise exception 'citizen wrote into another user''s folder';
  exception when insufficient_privilege then null; end;
  insert into storage.objects (bucket_id, name) values ('janseva-notices', '00000000-0000-0000-0000-00000000000a/x.jpg');
end $$;

-- Citizen B cannot see A's timeline
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  if (select count(*) from janseva.report_events) <> 0 then raise exception 'timeline leaked to another citizen'; end if;
end $$;

-- Officer of Hazratganj sees only their ward
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  if (select string_agg(text, ',') from janseva.reports) <> 'a pothole'
  then raise exception 'officer sees reports outside their ward'; end if;
end $$;

reset role;
do $$ begin
  begin
    update janseva.report_events set note = 'edited';
    raise exception 'report_events is editable';
  exception when raise_exception then
    if sqlerrm = 'report_events is editable' then raise; end if;
  end;
end $$;

-- The janseva schema is fully isolated: it never touches the "public" schema at all (which
-- another app on this project may already own).
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name in
               ('profiles','reports','clusters','notices','deadlines','sources','schemes'))
  then raise exception 'a janseva table leaked into the public schema'; end if;
end $$;

select 'rls ok';
