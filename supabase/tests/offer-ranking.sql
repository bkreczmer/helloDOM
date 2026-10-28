-- Schema checks for offers and the ranking rule (migration 20261028140000_create_offers.sql):
-- the score components and their bounds, the filters and tie-breaks of rank_agents_for_offer,
-- the offers check constraints, the column-level insert grant and the offers RLS policies.
-- Runs in one transaction and rolls back, so it leaves no data behind.
-- Local: docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/offer-ranking.sql
-- Expected failures are caught inside do blocks; any other exception stops the script.

\set ON_ERROR_STOP on

begin;

-- Agents already in the local database (dev accounts) must not interfere with the ranking:
-- inside this transaction they serve no city, so their profiles are incomplete.
update public.profiles set cities = '{}' where role = 'agent';

-- The on_auth_user_created trigger creates the profiles rows.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0001-000000000001', 'owner-1@offer-ranking.test', '{"role":"owner"}'),
  ('00000000-0000-0000-0001-000000000002', 'owner-2@offer-ranking.test', '{"role":"owner"}'),
  ('00000000-0000-0000-0001-000000000011', 'agent-p@offer-ranking.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0001-000000000021', 'agent-a@offer-ranking.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0001-000000000022', 'agent-b@offer-ranking.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0001-000000000023', 'agent-c@offer-ranking.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0001-000000000024', 'agent-d@offer-ranking.test', '{"role":"agent"}');

-- Two offers of owner 1: one for the single-agent probe (opole), one for the ordering (rzeszow).
insert into public.offers (id, owner_id, city, property_type, transaction, price) values
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0001-000000000001', 'opole', 'apartment', 'sale', 500000),
  ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0001-000000000001', 'rzeszow', 'apartment', 'sale', 500000);

-- ---------------------------------------------------------------------------------------------
-- Score components, probed with a single agent P in opole (offer: apartment, 500000).
-- Calls run as postgres with owner 1's claims: auth.uid() reads the claims either way.
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0001-000000000001","role":"authenticated"}';

-- P's score in the probe offer's ranking, or null when P is absent.
create function pg_temp.expect_probe(expected integer, label text) returns void
language plpgsql as $$
declare got integer;
begin
  select r.score into got
  from public.rank_agents_for_offer('00000000-0000-0000-0002-000000000001') r
  where r.agent_id = '00000000-0000-0000-0001-000000000011';
  if got is distinct from expected then
    raise exception '%: expected score %, got %', label, coalesce(expected::text, 'absent'), coalesce(got::text, 'absent');
  end if;
end $$;

-- Type only: 35.
update public.profiles
  set cities = '{opole}', property_types = '{apartment}', price_min = 600000, price_max = 900000, experience_years = 0
  where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(35, 'type only');

-- Price only: 35.
update public.profiles
  set property_types = '{house}', price_min = 100000, price_max = 900000, experience_years = 0
  where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(35, 'price only');

-- Experience only: 3 per year.
update public.profiles
  set property_types = '{house}', price_min = 600000, price_max = 900000, experience_years = 1
  where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(3, 'experience 1 year');
update public.profiles set experience_years = 4 where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(12, 'experience 4 years');

-- Experience capped at 10 years.
update public.profiles set experience_years = 10 where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(30, 'experience 10 years');
update public.profiles set experience_years = 25 where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(30, 'experience 25 years');

-- Price bounds are inclusive; one off is outside. With no other component the score is 0,
-- so the agent is absent (an agent in the city with score 0 never appears).
update public.profiles
  set property_types = '{house}', price_min = 500000, price_max = 900000, experience_years = 0
  where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(35, 'price = price_min');
update public.profiles set price_min = 100000, price_max = 500000 where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(35, 'price = price_max');
update public.profiles set price_min = 500001, price_max = 900000 where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(null, 'price = price_min - 1 (score 0)');
update public.profiles set price_min = 100000, price_max = 499999 where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(null, 'price = price_max + 1 (score 0)');

-- All components: 100.
update public.profiles
  set property_types = '{apartment,plot}', price_min = 100000, price_max = 900000, experience_years = 12
  where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(100, 'all components');

-- City gate: a full match outside the offer's city is absent.
update public.profiles set cities = '{kielce,lublin}' where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(null, 'city gate');
update public.profiles set cities = '{kielce,opole}' where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(100, 'one of several cities');

-- Incomplete profile is absent.
update public.profiles set experience_years = null where id = '00000000-0000-0000-0001-000000000011';
select pg_temp.expect_probe(null, 'incomplete profile');
update public.profiles set experience_years = 10 where id = '00000000-0000-0000-0001-000000000011';

-- An owner with agent-like fields is never ranked.
update public.profiles
  set cities = '{opole}', property_types = '{apartment}', price_min = 100000, price_max = 900000, experience_years = 10
  where id = '00000000-0000-0000-0001-000000000002';
do $$
declare n integer;
begin
  select count(*) into n from public.rank_agents_for_offer('00000000-0000-0000-0002-000000000001');
  if n <> 1 then raise exception 'owner not ranked: expected only agent P, got % rows', n; end if;
  if exists (
    select 1 from public.rank_agents_for_offer('00000000-0000-0000-0002-000000000001')
    where agent_id = '00000000-0000-0000-0001-000000000002'
  ) then
    raise exception 'owner not ranked: owner 2 appears in the ranking';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Ordering and limit, four agents in rzeszow (offer: apartment, 500000).
-- A: 100 (10 years), B: 100 (25 years), C and D: 85 (5 years). B has the higher id, so only the
-- experience tie-break puts B above A. D was created earlier than C,
-- while C has the lower id, so only the created_at tie-break puts D above C.
-- ---------------------------------------------------------------------------------------------

update public.profiles
  set cities = '{rzeszow}', property_types = '{apartment}', price_min = 100000, price_max = 900000
  where id in (
    '00000000-0000-0000-0001-000000000021', '00000000-0000-0000-0001-000000000022',
    '00000000-0000-0000-0001-000000000023', '00000000-0000-0000-0001-000000000024'
  );
update public.profiles set experience_years = 10 where id = '00000000-0000-0000-0001-000000000021';
update public.profiles set experience_years = 25 where id = '00000000-0000-0000-0001-000000000022';
update public.profiles set experience_years = 5, created_at = '2026-01-02 00:00:00+00'
  where id = '00000000-0000-0000-0001-000000000023';
update public.profiles set experience_years = 5, created_at = '2026-01-01 00:00:00+00'
  where id = '00000000-0000-0000-0001-000000000024';

-- As owner 1 through the authenticated role.
set local role authenticated;

do $$
declare
  got uuid[];
  scores integer[];
begin
  select array_agg(r.agent_id order by ord), array_agg(r.score order by ord)
    into got, scores
    from public.rank_agents_for_offer('00000000-0000-0000-0002-000000000002') with ordinality as r(agent_id, score, experience_years, cities, ord);
  if got is distinct from array[
    '00000000-0000-0000-0001-000000000022',
    '00000000-0000-0000-0001-000000000021',
    '00000000-0000-0000-0001-000000000024'
  ]::uuid[] then
    raise exception 'ordering: expected B, A, D (exactly 3), got %', got;
  end if;
  if scores is distinct from array[100, 100, 85] then
    raise exception 'ordering: expected scores 100, 100, 85, got %', scores;
  end if;
end $$;

-- Returned columns carry the agent's experience and cities.
do $$
declare r record;
begin
  select * into r from public.rank_agents_for_offer('00000000-0000-0000-0002-000000000002') limit 1;
  if r.experience_years <> 25 or r.cities is distinct from '{rzeszow}'::text[] then
    raise exception 'returned columns: expected 25 years and {rzeszow}, got % and %', r.experience_years, r.cities;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- offers RLS and grants.
-- ---------------------------------------------------------------------------------------------

-- Insert as owner 1: owner_id and status come from the defaults.
do $$
declare o public.offers;
begin
  insert into public.offers (city, property_type, transaction, price, area_m2, rooms, description)
    values ('gdansk', 'house', 'rent', 4000, 120.5, 5, 'Dom z ogrodem')
    returning * into o;
  if o.owner_id is distinct from '00000000-0000-0000-0001-000000000001'::uuid then
    raise exception 'owner insert: owner_id should be auth.uid(), got %', o.owner_id;
  end if;
  if o.status is distinct from 'seeking_agent' then
    raise exception 'owner insert: status should be seeking_agent, got %', o.status;
  end if;
end $$;

-- No column grant on status or owner_id.
do $$ begin
  insert into public.offers (city, property_type, transaction, price, status)
    values ('gdansk', 'house', 'sale', 100000, 'in_progress');
  raise exception 'expected failure: insert with explicit status';
exception when insufficient_privilege then null; end $$;

do $$ begin
  insert into public.offers (city, property_type, transaction, price, owner_id)
    values ('gdansk', 'house', 'sale', 100000, '00000000-0000-0000-0001-000000000002');
  raise exception 'expected failure: insert with explicit owner_id';
exception when insufficient_privilege then null; end $$;

-- Owner 1 sees only own offers: the two set up above and the one just inserted.
do $$
declare n integer;
begin
  select count(*) into n from public.offers;
  if n <> 3 then raise exception 'owner 1 select: expected 3 own offers, got %', n; end if;
  if exists (select 1 from public.offers where owner_id <> '00000000-0000-0000-0001-000000000001') then
    raise exception 'owner 1 select: sees an offer of someone else';
  end if;
end $$;

-- As owner 2: owner 1's offers are invisible and not rankable.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0001-000000000002","role":"authenticated"}';

do $$
declare n integer;
begin
  select count(*) into n from public.rank_agents_for_offer('00000000-0000-0000-0002-000000000002');
  if n <> 0 then raise exception 'foreign offer ranking: expected 0 rows, got %', n; end if;
  select count(*) into n from public.offers;
  if n <> 0 then raise exception 'owner 2 select: expected 0 offers, got %', n; end if;
end $$;

-- As an agent: insert rejected by the owner-only policy.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0001-000000000011","role":"authenticated"}';

do $$ begin
  insert into public.offers (city, property_type, transaction, price)
    values ('opole', 'apartment', 'sale', 500000);
  raise exception 'expected failure: insert as agent';
exception when insufficient_privilege then
  if sqlerrm not like '%row-level security%' then raise; end if;
end $$;

reset role;

-- Function privileges: authenticated may execute, anon may not.
do $$
begin
  if has_function_privilege('anon', 'public.rank_agents_for_offer(uuid)', 'execute') then
    raise exception 'anon must not execute rank_agents_for_offer';
  end if;
  if not has_function_privilege('authenticated', 'public.rank_agents_for_offer(uuid)', 'execute') then
    raise exception 'authenticated must execute rank_agents_for_offer';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- offers check constraints (as postgres, with a valid owner_id).
-- ---------------------------------------------------------------------------------------------

do $$ begin
  insert into public.offers (owner_id, city, property_type, transaction, price)
    values ('00000000-0000-0000-0001-000000000001', 'paris', 'apartment', 'sale', 500000);
  raise exception 'expected failure: city outside the dictionary';
exception when check_violation then null; end $$;

do $$ begin
  insert into public.offers (owner_id, city, property_type, transaction, price)
    values ('00000000-0000-0000-0001-000000000001', 'opole', 'castle', 'sale', 500000);
  raise exception 'expected failure: property type outside the dictionary';
exception when check_violation then null; end $$;

do $$ begin
  insert into public.offers (owner_id, city, property_type, transaction, price)
    values ('00000000-0000-0000-0001-000000000001', 'opole', 'apartment', 'lease', 500000);
  raise exception 'expected failure: transaction outside the dictionary';
exception when check_violation then null; end $$;

do $$ begin
  insert into public.offers (owner_id, city, property_type, transaction, price)
    values ('00000000-0000-0000-0001-000000000001', 'opole', 'apartment', 'sale', 0);
  raise exception 'expected failure: price = 0';
exception when check_violation then null; end $$;

do $$ begin
  insert into public.offers (owner_id, city, property_type, transaction, price)
    values ('00000000-0000-0000-0001-000000000001', 'opole', 'apartment', 'sale', -1);
  raise exception 'expected failure: price = -1';
exception when check_violation then null; end $$;

do $$ begin
  insert into public.offers (owner_id, city, property_type, transaction, price, rooms)
    values ('00000000-0000-0000-0001-000000000001', 'opole', 'apartment', 'sale', 500000, 0);
  raise exception 'expected failure: rooms = 0';
exception when check_violation then null; end $$;

\echo 'offer-ranking: all checks passed'

rollback;
