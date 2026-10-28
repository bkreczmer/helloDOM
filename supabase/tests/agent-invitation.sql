-- Schema checks for invitations (migration 20261028180000_create_invitations.sql):
-- the result codes of invite_agent and its atomic offer status change, the invitations RLS
-- policies, the offers_select_invited_agent policy, the missing write grants, the partial
-- unique index of one active invitation per offer, the cascade and the function privileges.
-- Runs in one transaction and rolls back, so it leaves no data behind.
-- Local: docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/agent-invitation.sql
-- Expected failures are caught inside do blocks; any other exception stops the script.

\set ON_ERROR_STOP on

begin;

-- Agents already in the local database (dev accounts) must not interfere with the ranking:
-- inside this transaction they serve no city, so their profiles are incomplete.
update public.profiles set cities = '{}' where role = 'agent';

-- The on_auth_user_created trigger creates the profiles rows.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0003-000000000001', 'owner-1@agent-invitation.test', '{"role":"owner"}'),
  ('00000000-0000-0000-0003-000000000002', 'owner-2@agent-invitation.test', '{"role":"owner"}'),
  ('00000000-0000-0000-0003-000000000011', 'agent-a@agent-invitation.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0003-000000000012', 'agent-b@agent-invitation.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0003-000000000013', 'agent-c@agent-invitation.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0003-000000000014', 'agent-d@agent-invitation.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0003-000000000015', 'agent-e@agent-invitation.test', '{"role":"agent"}');

-- Four agents in rzeszow: A 100, B 94, C 88, D 82, so the top 3 is A, B, C and D is fourth.
-- Agent E is a full match, but in opole.
update public.profiles
  set cities = '{rzeszow}', property_types = '{apartment}', price_min = 100000, price_max = 900000
  where id in (
    '00000000-0000-0000-0003-000000000011', '00000000-0000-0000-0003-000000000012',
    '00000000-0000-0000-0003-000000000013', '00000000-0000-0000-0003-000000000014'
  );
update public.profiles set experience_years = 10 where id = '00000000-0000-0000-0003-000000000011';
update public.profiles set experience_years = 8 where id = '00000000-0000-0000-0003-000000000012';
update public.profiles set experience_years = 6 where id = '00000000-0000-0000-0003-000000000013';
update public.profiles set experience_years = 4 where id = '00000000-0000-0000-0003-000000000014';
update public.profiles
  set cities = '{opole}', property_types = '{apartment}', price_min = 100000, price_max = 900000, experience_years = 10
  where id = '00000000-0000-0000-0003-000000000015';

-- O1 and O2 belong to owner 1, O3 to owner 2; all in rzeszow (apartment, sale, 500000).
insert into public.offers (id, owner_id, city, property_type, transaction, price) values
  ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0003-000000000001', 'rzeszow', 'apartment', 'sale', 500000),
  ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000001', 'rzeszow', 'apartment', 'sale', 500000),
  ('00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0003-000000000002', 'rzeszow', 'apartment', 'sale', 500000);

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- invite_agent result codes, as owner 1.
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0003-000000000001","role":"authenticated"}';

-- Agent from the top 3: ok, the offer is invited, the invitation is pending with owner 1.
do $$
declare
  res text;
  inv public.invitations;
begin
  res := public.invite_agent('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0003-000000000012');
  if res is distinct from 'ok' then raise exception 'invite top 3 agent: expected ok, got %', res; end if;
  if (select status from public.offers where id = '00000000-0000-0000-0004-000000000001') is distinct from 'invited' then
    raise exception 'invite top 3 agent: offer status should be invited';
  end if;
  select * into strict inv from public.invitations where offer_id = '00000000-0000-0000-0004-000000000001';
  if inv.agent_id <> '00000000-0000-0000-0003-000000000012'
     or inv.owner_id <> '00000000-0000-0000-0003-000000000001'
     or inv.status <> 'pending' then
    raise exception 'invite top 3 agent: unexpected invitation row %', inv;
  end if;
end $$;

-- A second invitation to the same offer (another top 3 agent): offer_locked, nothing changes.
do $$
declare
  res text;
  n integer;
begin
  res := public.invite_agent('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0003-000000000011');
  if res is distinct from 'offer_locked' then raise exception 'second invitation: expected offer_locked, got %', res; end if;
  select count(*) into n from public.invitations where offer_id = '00000000-0000-0000-0004-000000000001';
  if n <> 1 then raise exception 'second invitation: expected 1 invitation, got %', n; end if;
  if not exists (
    select 1 from public.invitations
    where offer_id = '00000000-0000-0000-0004-000000000001'
      and agent_id = '00000000-0000-0000-0003-000000000012' and status = 'pending'
  ) then
    raise exception 'second invitation: the first invitation changed';
  end if;
  if (select status from public.offers where id = '00000000-0000-0000-0004-000000000001') is distinct from 'invited' then
    raise exception 'second invitation: offer status should stay invited';
  end if;
end $$;

-- Agents outside the top 3: the fourth one, one from another city, a random uuid.
do $$
declare res text;
begin
  res := public.invite_agent('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000014');
  if res is distinct from 'agent_not_ranked' then raise exception 'fourth agent: expected agent_not_ranked, got %', res; end if;
  res := public.invite_agent('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000015');
  if res is distinct from 'agent_not_ranked' then raise exception 'other city agent: expected agent_not_ranked, got %', res; end if;
  res := public.invite_agent('00000000-0000-0000-0004-000000000002', gen_random_uuid());
  if res is distinct from 'agent_not_ranked' then raise exception 'random uuid: expected agent_not_ranked, got %', res; end if;
  if exists (select 1 from public.invitations where offer_id = '00000000-0000-0000-0004-000000000002') then
    raise exception 'agent_not_ranked: an invitation was inserted';
  end if;
  if (select status from public.offers where id = '00000000-0000-0000-0004-000000000002') is distinct from 'seeking_agent' then
    raise exception 'agent_not_ranked: offer status should stay seeking_agent';
  end if;
end $$;

-- A missing offer: not_found.
do $$
declare res text;
begin
  res := public.invite_agent(gen_random_uuid(), '00000000-0000-0000-0003-000000000011');
  if res is distinct from 'not_found' then raise exception 'missing offer: expected not_found, got %', res; end if;
end $$;

-- As owner 2: owner 1's offer is not_found; own offer O3 is ok (used for the isolation checks).
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0003-000000000002","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.invite_agent('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000011');
  if res is distinct from 'not_found' then raise exception 'foreign offer: expected not_found, got %', res; end if;
  res := public.invite_agent('00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0003-000000000011');
  if res is distinct from 'ok' then raise exception 'owner 2 own offer: expected ok, got %', res; end if;
end $$;

-- As an agent: not_found, even for an offer the agent is invited to.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0003-000000000011","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.invite_agent('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000012');
  if res is distinct from 'not_found' then raise exception 'agent call: expected not_found, got %', res; end if;
  res := public.invite_agent('00000000-0000-0000-0004-000000000003', '00000000-0000-0000-0003-000000000012');
  if res is distinct from 'not_found' then raise exception 'agent call on invited offer: expected not_found, got %', res; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Visibility. Invitations now: O1 -> agent B (owner 1), O3 -> agent A (owner 2).
-- ---------------------------------------------------------------------------------------------

-- Agent A sees O3 and only own invitation.
do $$
declare n integer;
begin
  select count(*) into n from public.offers;
  if n <> 1 or not exists (select 1 from public.offers where id = '00000000-0000-0000-0004-000000000003') then
    raise exception 'agent A offers: expected only O3, got % rows', n;
  end if;
  select count(*) into n from public.invitations;
  if n <> 1 or exists (select 1 from public.invitations where agent_id <> '00000000-0000-0000-0003-000000000011') then
    raise exception 'agent A invitations: expected only own invitation, got % rows', n;
  end if;
end $$;

-- Agent C, not invited anywhere, sees no offers and no invitations.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0003-000000000013","role":"authenticated"}';

do $$
declare n integer;
begin
  select count(*) into n from public.offers;
  if n <> 0 then raise exception 'uninvited agent offers: expected 0, got %', n; end if;
  select count(*) into n from public.invitations;
  if n <> 0 then raise exception 'uninvited agent invitations: expected 0, got %', n; end if;
end $$;

-- Owner 1 sees only the invitations of own offers.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0003-000000000001","role":"authenticated"}';

do $$
declare n integer;
begin
  select count(*) into n from public.invitations;
  if n <> 1 or exists (select 1 from public.invitations where owner_id <> '00000000-0000-0000-0003-000000000001') then
    raise exception 'owner 1 invitations: expected only own offer invitation, got % rows', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- No direct writes for authenticated (as owner 1, then as agent B).
-- ---------------------------------------------------------------------------------------------

do $$ begin
  insert into public.invitations (offer_id, agent_id, owner_id)
    values ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000011', '00000000-0000-0000-0003-000000000001');
  raise exception 'expected failure: insert invitation as owner';
exception when insufficient_privilege then null; end $$;

do $$ begin
  update public.invitations set status = 'rejected' where offer_id = '00000000-0000-0000-0004-000000000001';
  raise exception 'expected failure: update invitation as owner';
exception when insufficient_privilege then null; end $$;

do $$ begin
  delete from public.invitations where offer_id = '00000000-0000-0000-0004-000000000001';
  raise exception 'expected failure: delete invitation as owner';
exception when insufficient_privilege then null; end $$;

do $$ begin
  update public.offers set status = 'seeking_agent' where id = '00000000-0000-0000-0004-000000000001';
  raise exception 'expected failure: update offers.status as owner';
exception when insufficient_privilege then null; end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0003-000000000012","role":"authenticated"}';

do $$ begin
  update public.invitations set status = 'accepted' where agent_id = '00000000-0000-0000-0003-000000000012';
  raise exception 'expected failure: update invitation as agent';
exception when insufficient_privilege then null; end $$;

do $$ begin
  update public.offers set status = 'in_progress' where id = '00000000-0000-0000-0004-000000000001';
  raise exception 'expected failure: update offers.status as agent';
exception when insufficient_privilege then null; end $$;

-- ---------------------------------------------------------------------------------------------
-- A rejected invitation no longer opens the offer, but stays visible to the agent.
-- ---------------------------------------------------------------------------------------------

reset role;
update public.invitations set status = 'rejected'
  where offer_id = '00000000-0000-0000-0004-000000000001' and agent_id = '00000000-0000-0000-0003-000000000012';
set local role authenticated;

do $$
declare n integer;
begin
  select count(*) into n from public.offers;
  if n <> 0 then raise exception 'rejected agent offers: expected 0, got %', n; end if;
  select count(*) into n from public.invitations where status = 'rejected';
  if n <> 1 then raise exception 'rejected agent invitations: expected own rejected invitation, got %', n; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The partial unique index (as postgres), and invite_agent turning its violation into offer_locked.
-- ---------------------------------------------------------------------------------------------

reset role;

-- O2 gets a pending invitation behind invite_agent's back, while still seeking_agent.
insert into public.invitations (offer_id, agent_id, owner_id)
  values ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000013', '00000000-0000-0000-0003-000000000001');

do $$ begin
  insert into public.invitations (offer_id, agent_id, owner_id)
    values ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000011', '00000000-0000-0000-0003-000000000001');
  raise exception 'expected failure: second pending invitation for an offer';
exception when unique_violation then null; end $$;

do $$ begin
  insert into public.invitations (offer_id, agent_id, owner_id, status)
    values ('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000011', '00000000-0000-0000-0003-000000000001', 'accepted');
  raise exception 'expected failure: accepted next to a pending invitation';
exception when unique_violation then null; end $$;

-- O1 has only a rejected invitation: a new pending one for another agent passes.
insert into public.invitations (offer_id, agent_id, owner_id)
  values ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0003-000000000011', '00000000-0000-0000-0003-000000000001');

-- The same agent twice for one offer is rejected by unique (offer_id, agent_id).
do $$ begin
  insert into public.invitations (offer_id, agent_id, owner_id, status)
    values ('00000000-0000-0000-0004-000000000001', '00000000-0000-0000-0003-000000000012', '00000000-0000-0000-0003-000000000001', 'rejected');
  raise exception 'expected failure: same agent twice for one offer';
exception when unique_violation then null; end $$;

-- invite_agent on O2 hits the index: offer_locked, the offer stays seeking_agent.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0003-000000000001","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.invite_agent('00000000-0000-0000-0004-000000000002', '00000000-0000-0000-0003-000000000011');
  if res is distinct from 'offer_locked' then raise exception 'unique_violation: expected offer_locked, got %', res; end if;
  if (select status from public.offers where id = '00000000-0000-0000-0004-000000000002') is distinct from 'seeking_agent' then
    raise exception 'unique_violation: offer status should stay seeking_agent';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------------------------
-- Cascade and function privileges.
-- ---------------------------------------------------------------------------------------------

delete from public.offers where id = '00000000-0000-0000-0004-000000000001';
do $$
begin
  if exists (select 1 from public.invitations where offer_id = '00000000-0000-0000-0004-000000000001') then
    raise exception 'cascade: invitations of a deleted offer remain';
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.invite_agent(uuid, uuid)', 'execute') then
    raise exception 'anon must not execute invite_agent';
  end if;
  if not has_function_privilege('authenticated', 'public.invite_agent(uuid, uuid)', 'execute') then
    raise exception 'authenticated must execute invite_agent';
  end if;
end $$;

\echo 'agent-invitation: all checks passed'

rollback;
