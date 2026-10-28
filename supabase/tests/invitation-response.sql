-- Schema checks for the invitation response (migration 20261028200000_invitation_response.sql):
-- the result codes of respond_to_invitation and its atomic invitation and offer status changes,
-- rank_agents_for_offer leaving out the agent who rejected, the offer visibility after rejecting
-- and accepting, the missing write grants, the responded_at check and the function privileges.
-- Runs in one transaction and rolls back, so it leaves no data behind.
-- Local: docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/invitation-response.sql
-- Expected failures are caught inside do blocks; any other exception stops the script.

\set ON_ERROR_STOP on

begin;

-- Agents already in the local database (dev accounts) must not interfere with the ranking:
-- inside this transaction they serve no city, so their profiles are incomplete.
update public.profiles set cities = '{}' where role = 'agent';

-- The on_auth_user_created trigger creates the profiles rows.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0005-000000000001', 'owner-1@invitation-response.test', '{"role":"owner"}'),
  ('00000000-0000-0000-0005-000000000011', 'agent-a@invitation-response.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0005-000000000012', 'agent-b@invitation-response.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0005-000000000013', 'agent-c@invitation-response.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0005-000000000014', 'agent-d@invitation-response.test', '{"role":"agent"}');

-- Four agents in rzeszow: A 100, B 94, C 88, D 82, so the top 3 is A, B, C and D is fourth.
update public.profiles
  set cities = '{rzeszow}', property_types = '{apartment}', price_min = 100000, price_max = 900000
  where id in (
    '00000000-0000-0000-0005-000000000011', '00000000-0000-0000-0005-000000000012',
    '00000000-0000-0000-0005-000000000013', '00000000-0000-0000-0005-000000000014'
  );
update public.profiles set experience_years = 10 where id = '00000000-0000-0000-0005-000000000011';
update public.profiles set experience_years = 8 where id = '00000000-0000-0000-0005-000000000012';
update public.profiles set experience_years = 6 where id = '00000000-0000-0000-0005-000000000013';
update public.profiles set experience_years = 4 where id = '00000000-0000-0000-0005-000000000014';

-- O1 and O2 belong to owner 1, both in rzeszow (apartment, sale, 500000).
insert into public.offers (id, owner_id, city, property_type, transaction, price) values
  ('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0005-000000000001', 'rzeszow', 'apartment', 'sale', 500000),
  ('00000000-0000-0000-0006-000000000002', '00000000-0000-0000-0005-000000000001', 'rzeszow', 'apartment', 'sale', 500000);

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Agent A (top 1) rejects.
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0005-000000000001","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.invite_agent('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0005-000000000011');
  if res is distinct from 'ok' then raise exception 'invite agent A: expected ok, got %', res; end if;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0005-000000000011","role":"authenticated"}';

-- ok, the invitation is rejected with a response date, and agent A no longer sees the offer.
do $$
declare
  res text;
  inv public.invitations;
begin
  res := public.respond_to_invitation('00000000-0000-0000-0006-000000000001', 'reject');
  if res is distinct from 'ok' then raise exception 'agent A reject: expected ok, got %', res; end if;
  select * into strict inv from public.invitations where offer_id = '00000000-0000-0000-0006-000000000001';
  if inv.status <> 'rejected' or inv.responded_at is null then
    raise exception 'agent A reject: unexpected invitation row %', inv;
  end if;
  if exists (select 1 from public.offers where id = '00000000-0000-0000-0006-000000000001') then
    raise exception 'agent A reject: the offer is still visible to agent A';
  end if;
end $$;

-- A second answer to the rejected invitation: already_responded, not not_found.
do $$
declare res text;
begin
  res := public.respond_to_invitation('00000000-0000-0000-0006-000000000001', 'reject');
  if res is distinct from 'already_responded' then raise exception 'agent A second reject: expected already_responded, got %', res; end if;
  res := public.respond_to_invitation('00000000-0000-0000-0006-000000000001', 'accept');
  if res is distinct from 'already_responded' then raise exception 'agent A accept after reject: expected already_responded, got %', res; end if;
  if (select status from public.invitations where offer_id = '00000000-0000-0000-0006-000000000001') is distinct from 'rejected' then
    raise exception 'agent A second answer: the invitation changed';
  end if;
end $$;

-- As owner 1: the offer is seeking an agent again, A is out of the ranking, D moves up,
-- A cannot be invited again, and B can.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0005-000000000001","role":"authenticated"}';

do $$
declare
  res text;
  ranked uuid[];
begin
  if (select status from public.offers where id = '00000000-0000-0000-0006-000000000001') is distinct from 'seeking_agent' then
    raise exception 'after reject: offer status should be seeking_agent';
  end if;
  select array_agg(r.agent_id order by r.score desc) into ranked
  from public.rank_agents_for_offer('00000000-0000-0000-0006-000000000001') r;
  if ranked is distinct from array[
    '00000000-0000-0000-0005-000000000012', '00000000-0000-0000-0005-000000000013',
    '00000000-0000-0000-0005-000000000014'
  ]::uuid[] then
    raise exception 'after reject: expected ranking B, C, D, got %', ranked;
  end if;
  -- O2 has no rejection, so A is still its top 1.
  if (select r.agent_id from public.rank_agents_for_offer('00000000-0000-0000-0006-000000000002') r
      order by r.score desc limit 1) is distinct from '00000000-0000-0000-0005-000000000011' then
    raise exception 'after reject: A should still lead the ranking of another offer';
  end if;
  res := public.invite_agent('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0005-000000000011');
  if res is distinct from 'agent_not_ranked' then raise exception 'reinvite agent A: expected agent_not_ranked, got %', res; end if;
  res := public.invite_agent('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0005-000000000012');
  if res is distinct from 'ok' then raise exception 'invite agent B: expected ok, got %', res; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Agent B accepts.
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0005-000000000012","role":"authenticated"}';

do $$
declare
  res text;
  inv public.invitations;
begin
  res := public.respond_to_invitation('00000000-0000-0000-0006-000000000001', 'accept');
  if res is distinct from 'ok' then raise exception 'agent B accept: expected ok, got %', res; end if;
  select * into strict inv from public.invitations where offer_id = '00000000-0000-0000-0006-000000000001';
  if inv.status <> 'accepted' or inv.responded_at is null then
    raise exception 'agent B accept: unexpected invitation row %', inv;
  end if;
  -- Agent B still sees the offer, now in progress.
  if (select status from public.offers where id = '00000000-0000-0000-0006-000000000001') is distinct from 'in_progress' then
    raise exception 'agent B accept: offer should be visible and in_progress';
  end if;
end $$;

-- A second answer (reject) after accepting: already_responded, nothing changes.
do $$
declare
  res text;
  v_responded_at timestamptz;
begin
  select responded_at into v_responded_at from public.invitations
    where offer_id = '00000000-0000-0000-0006-000000000001';
  res := public.respond_to_invitation('00000000-0000-0000-0006-000000000001', 'reject');
  if res is distinct from 'already_responded' then raise exception 'agent B reject after accept: expected already_responded, got %', res; end if;
  if not exists (
    select 1 from public.invitations
    where offer_id = '00000000-0000-0000-0006-000000000001'
      and status = 'accepted' and responded_at = v_responded_at
  ) then
    raise exception 'agent B reject after accept: the invitation changed';
  end if;
  if (select status from public.offers where id = '00000000-0000-0000-0006-000000000001') is distinct from 'in_progress' then
    raise exception 'agent B reject after accept: offer status should stay in_progress';
  end if;
end $$;

-- invalid_response comes before any lookup.
do $$
declare res text;
begin
  res := public.respond_to_invitation('00000000-0000-0000-0006-000000000001', 'maybe');
  if res is distinct from 'invalid_response' then raise exception 'maybe: expected invalid_response, got %', res; end if;
  res := public.respond_to_invitation('00000000-0000-0000-0006-000000000001', null);
  if res is distinct from 'invalid_response' then raise exception 'null response: expected invalid_response, got %', res; end if;
end $$;

-- No direct write for authenticated.
do $$ begin
  update public.invitations set status = 'accepted' where agent_id = '00000000-0000-0000-0005-000000000012';
  raise exception 'expected failure: update invitation as agent';
exception when insufficient_privilege then null; end $$;

-- As owner 1: the accepted offer is locked for new invitations, and the owner cannot respond.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0005-000000000001","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.invite_agent('00000000-0000-0000-0006-000000000001', '00000000-0000-0000-0005-000000000013');
  if res is distinct from 'offer_locked' then raise exception 'invite after accept: expected offer_locked, got %', res; end if;
  res := public.respond_to_invitation('00000000-0000-0000-0006-000000000001', 'reject');
  if res is distinct from 'not_found' then raise exception 'owner response: expected not_found, got %', res; end if;
end $$;

-- As agent C, without an invitation: not_found, also for a missing offer.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0005-000000000013","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.respond_to_invitation('00000000-0000-0000-0006-000000000001', 'accept');
  if res is distinct from 'not_found' then raise exception 'uninvited agent: expected not_found, got %', res; end if;
  res := public.respond_to_invitation(gen_random_uuid(), 'accept');
  if res is distinct from 'not_found' then raise exception 'missing offer: expected not_found, got %', res; end if;
end $$;

reset role;

-- The final state, as postgres: one accepted and one rejected invitation, the offer in progress.
do $$
begin
  if (select status from public.offers where id = '00000000-0000-0000-0006-000000000001') is distinct from 'in_progress' then
    raise exception 'final state: offer should be in_progress';
  end if;
  if (select array_agg(status order by status) from public.invitations
      where offer_id = '00000000-0000-0000-0006-000000000001') is distinct from array['accepted', 'rejected'] then
    raise exception 'final state: expected one accepted and one rejected invitation';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The responded_at check (as postgres) and function privileges.
-- ---------------------------------------------------------------------------------------------

do $$ begin
  insert into public.invitations (offer_id, agent_id, owner_id, responded_at)
    values ('00000000-0000-0000-0006-000000000002', '00000000-0000-0000-0005-000000000014', '00000000-0000-0000-0005-000000000001', now());
  raise exception 'expected failure: pending invitation with responded_at';
exception when check_violation then null; end $$;

do $$ begin
  insert into public.invitations (offer_id, agent_id, owner_id, status)
    values ('00000000-0000-0000-0006-000000000002', '00000000-0000-0000-0005-000000000014', '00000000-0000-0000-0005-000000000001', 'rejected');
  raise exception 'expected failure: rejected invitation without responded_at';
exception when check_violation then null; end $$;

do $$
begin
  if has_function_privilege('anon', 'public.respond_to_invitation(uuid, text)', 'execute') then
    raise exception 'anon must not execute respond_to_invitation';
  end if;
  if not has_function_privilege('authenticated', 'public.respond_to_invitation(uuid, text)', 'execute') then
    raise exception 'authenticated must execute respond_to_invitation';
  end if;
  if has_function_privilege('anon', 'public.rank_agents_for_offer(uuid)', 'execute') then
    raise exception 'anon must not execute rank_agents_for_offer';
  end if;
  if not has_function_privilege('authenticated', 'public.rank_agents_for_offer(uuid)', 'execute') then
    raise exception 'authenticated must execute rank_agents_for_offer';
  end if;
end $$;

\echo 'invitation-response: all checks passed'

rollback;
