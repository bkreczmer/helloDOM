-- Schema checks for the agent profile (migration 20261028100000_add_agent_profile.sql):
-- dictionary and range constraints, the generated profile_complete column, the column-level
-- update grant and the profiles_update_own_agent policy.
-- Runs in one transaction and rolls back, so it leaves no data behind.
-- Local: docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/agent-profile.sql
-- Expected failures are caught inside do blocks; any other exception stops the script.

\set ON_ERROR_STOP on

begin;

-- The on_auth_user_created trigger creates the profiles rows.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'agent-a@test.local', '{"role":"agent"}'),
  ('00000000-0000-0000-0000-00000000000b', 'agent-b@test.local', '{"role":"agent"}'),
  ('00000000-0000-0000-0000-00000000000c', 'owner-c@test.local', '{"role":"owner"}');

-- New agent: empty profile, not complete.
do $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = '00000000-0000-0000-0000-00000000000a';
  if p.profile_complete is distinct from false then raise exception 'new agent: profile_complete should be false'; end if;
  if p.cities is distinct from '{}'::text[] then raise exception 'new agent: cities should be {}'; end if;
end $$;

-- All fields filled: complete.
update public.profiles
  set cities = '{krakow,lodz}', property_types = '{apartment}', price_min = 100000, price_max = 500000, experience_years = 5
  where id = '00000000-0000-0000-0000-00000000000a';
do $$
begin
  if not (select profile_complete from public.profiles where id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'filled profile: profile_complete should be true';
  end if;
end $$;

-- experience_years = 0 and price_min = price_max are allowed and still complete.
update public.profiles
  set experience_years = 0, price_min = 300000, price_max = 300000
  where id = '00000000-0000-0000-0000-00000000000a';
do $$
begin
  if not (select profile_complete from public.profiles where id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'experience_years = 0, price_min = price_max: profile_complete should be true';
  end if;
end $$;

-- Rejected by check constraints.
do $$ begin
  update public.profiles set cities = '{krakow,paris}' where id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'expected failure: city outside the dictionary';
exception when check_violation then null; end $$;

do $$ begin
  update public.profiles set property_types = '{castle}' where id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'expected failure: property type outside the dictionary';
exception when check_violation then null; end $$;

do $$ begin
  update public.profiles set price_min = -1 where id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'expected failure: price_min = -1';
exception when check_violation then null; end $$;

do $$ begin
  update public.profiles set price_min = 300000, price_max = 299999 where id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'expected failure: price_max < price_min';
exception when check_violation then null; end $$;

do $$ begin
  update public.profiles set experience_years = 61 where id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'expected failure: experience_years = 61';
exception when check_violation then null; end $$;

do $$ begin
  update public.profiles set experience_years = -1 where id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'expected failure: experience_years = -1';
exception when check_violation then null; end $$;

-- As agent A through RLS.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare n integer;
begin
  update public.profiles
    set cities = '{warszawa}', property_types = '{house,plot}', price_min = 0, price_max = 1000000, experience_years = 10
    where id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'agent A own row: expected 1 updated row, got %', n; end if;
end $$;

do $$
declare n integer;
begin
  update public.profiles set cities = '{warszawa}' where id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'agent A on agent B row: expected 0 updated rows, got %', n; end if;
end $$;

do $$ begin
  update public.profiles set role = 'owner' where id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'expected failure: update of role';
exception when insufficient_privilege then null; end $$;

-- As the owner: own row is not editable.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';

do $$
declare n integer;
begin
  update public.profiles set cities = '{warszawa}' where id = '00000000-0000-0000-0000-00000000000c';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'owner own row: expected 0 updated rows, got %', n; end if;
end $$;

reset role;

-- Agent A's update through RLS really landed; agent B and the owner are unchanged.
do $$
begin
  if (select cities from public.profiles where id = '00000000-0000-0000-0000-00000000000a') is distinct from '{warszawa}'::text[] then
    raise exception 'agent A row: update through RLS did not persist';
  end if;
  if exists (
    select 1 from public.profiles
    where id in ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c')
      and cities <> '{}'::text[]
  ) then
    raise exception 'agent B or owner row changed';
  end if;
end $$;

\echo 'agent-profile: all checks passed'

rollback;
