-- Schema checks for account deletion (migration 20261028220000_account_deletion.sql):
-- delete_own_account for an agent and an owner, the offer going back to 'seeking_agent' when its
-- active invitation is deleted (also through a plain delete from auth.users, as in the Supabase
-- dashboard), a rejected invitation leaving the offer alone, the call without auth.uid(), the
-- function privileges and the one-off repair query.
-- Runs in one transaction and rolls back, so it leaves no data behind.
-- Local: docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/account-deletion.sql
-- Expected failures are caught inside do blocks; any other exception stops the script.

\set ON_ERROR_STOP on

begin;

-- The on_auth_user_created trigger creates the profiles rows.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0007-000000000001', 'owner-1@account-deletion.test', '{"role":"owner"}'),
  ('00000000-0000-0000-0007-000000000002', 'owner-2@account-deletion.test', '{"role":"owner"}'),
  ('00000000-0000-0000-0007-000000000011', 'agent-a@account-deletion.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0007-000000000012', 'agent-b@account-deletion.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0007-000000000013', 'agent-c@account-deletion.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0007-000000000014', 'agent-d@account-deletion.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0007-000000000015', 'agent-e@account-deletion.test', '{"role":"agent"}');

-- Offers and invitations are inserted directly as postgres, with statuses that match:
--   O1 (owner 1): in_progress, agent A accepted;
--   O2 (owner 1): invited, agent B pending;
--   O3 (owner 1): invited, agent C rejected and agent D pending;
--   O4 (owner 1): in_progress, agent E accepted (deleted through auth.users as postgres);
--   O5 (owner 2): invited, agent D pending (owner 2 deletes the account);
--   O6 (owner 1): in_progress without any invitation (the repair query).
insert into public.offers (id, owner_id, city, property_type, transaction, price, status) values
  ('00000000-0000-0000-0007-000000000101', '00000000-0000-0000-0007-000000000001', 'rzeszow', 'apartment', 'sale', 500000, 'in_progress'),
  ('00000000-0000-0000-0007-000000000102', '00000000-0000-0000-0007-000000000001', 'rzeszow', 'apartment', 'sale', 500000, 'invited'),
  ('00000000-0000-0000-0007-000000000103', '00000000-0000-0000-0007-000000000001', 'rzeszow', 'apartment', 'sale', 500000, 'invited'),
  ('00000000-0000-0000-0007-000000000104', '00000000-0000-0000-0007-000000000001', 'rzeszow', 'apartment', 'sale', 500000, 'in_progress'),
  ('00000000-0000-0000-0007-000000000105', '00000000-0000-0000-0007-000000000002', 'rzeszow', 'apartment', 'sale', 500000, 'invited'),
  ('00000000-0000-0000-0007-000000000106', '00000000-0000-0000-0007-000000000001', 'rzeszow', 'apartment', 'sale', 500000, 'seeking_agent');

insert into public.invitations (offer_id, agent_id, owner_id, status, responded_at) values
  ('00000000-0000-0000-0007-000000000101', '00000000-0000-0000-0007-000000000011', '00000000-0000-0000-0007-000000000001', 'accepted', now()),
  ('00000000-0000-0000-0007-000000000102', '00000000-0000-0000-0007-000000000012', '00000000-0000-0000-0007-000000000001', 'pending', null),
  ('00000000-0000-0000-0007-000000000103', '00000000-0000-0000-0007-000000000013', '00000000-0000-0000-0007-000000000001', 'rejected', now()),
  ('00000000-0000-0000-0007-000000000103', '00000000-0000-0000-0007-000000000014', '00000000-0000-0000-0007-000000000001', 'pending', null),
  ('00000000-0000-0000-0007-000000000104', '00000000-0000-0000-0007-000000000015', '00000000-0000-0000-0007-000000000001', 'accepted', now()),
  ('00000000-0000-0000-0007-000000000105', '00000000-0000-0000-0007-000000000014', '00000000-0000-0000-0007-000000000002', 'pending', null);

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Agent A (accepted invitation to O1) deletes the account.
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000011","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.delete_own_account();
  if res is distinct from 'ok' then raise exception 'agent A delete: expected ok, got %', res; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Agent B (pending invitation to O2) deletes the account.
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000012","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.delete_own_account();
  if res is distinct from 'ok' then raise exception 'agent B delete: expected ok, got %', res; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Agent C (rejected invitation to O3, which has D's pending invitation) deletes the account.
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000013","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.delete_own_account();
  if res is distinct from 'ok' then raise exception 'agent C delete: expected ok, got %', res; end if;
end $$;

reset role;

-- As postgres: the agents and all their rows are gone, O1 and O2 are seeking an agent again,
-- O3 stays invited with D's pending invitation.
do $$
declare v_agent uuid;
begin
  foreach v_agent in array array[
    '00000000-0000-0000-0007-000000000011', '00000000-0000-0000-0007-000000000012',
    '00000000-0000-0000-0007-000000000013'
  ]::uuid[] loop
    if exists (select 1 from auth.users where id = v_agent) then
      raise exception 'agent %: auth.users row left', v_agent;
    end if;
    if exists (select 1 from public.profiles where id = v_agent) then
      raise exception 'agent %: profiles row left', v_agent;
    end if;
    if exists (select 1 from public.invitations where agent_id = v_agent) then
      raise exception 'agent %: invitations left', v_agent;
    end if;
  end loop;

  if (select status from public.offers where id = '00000000-0000-0000-0007-000000000101') is distinct from 'seeking_agent' then
    raise exception 'O1 after agent A deleted: expected seeking_agent';
  end if;
  if (select status from public.offers where id = '00000000-0000-0000-0007-000000000102') is distinct from 'seeking_agent' then
    raise exception 'O2 after agent B deleted: expected seeking_agent';
  end if;
  if (select status from public.offers where id = '00000000-0000-0000-0007-000000000103') is distinct from 'invited' then
    raise exception 'O3 after agent C deleted: expected invited';
  end if;
  if not exists (
    select 1 from public.invitations
    where offer_id = '00000000-0000-0000-0007-000000000103'
      and agent_id = '00000000-0000-0000-0007-000000000014' and status = 'pending'
  ) then
    raise exception 'O3 after agent C deleted: agent D pending invitation missing';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Agent E (accepted invitation to O4) is deleted as postgres, as in the Supabase dashboard.
-- ---------------------------------------------------------------------------------------------

delete from auth.users where id = '00000000-0000-0000-0007-000000000015';

do $$
begin
  if exists (select 1 from public.invitations where agent_id = '00000000-0000-0000-0007-000000000015') then
    raise exception 'agent E deleted as postgres: invitations left';
  end if;
  if (select status from public.offers where id = '00000000-0000-0000-0007-000000000104') is distinct from 'seeking_agent' then
    raise exception 'O4 after agent E deleted as postgres: expected seeking_agent';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Owner 2 (O5 with agent D pending) deletes the account.
-- ---------------------------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000002","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.delete_own_account();
  if res is distinct from 'ok' then raise exception 'owner 2 delete: expected ok, got %', res; end if;
end $$;

reset role;

do $$
begin
  if exists (select 1 from auth.users where id = '00000000-0000-0000-0007-000000000002') then
    raise exception 'owner 2: auth.users row left';
  end if;
  if exists (select 1 from public.profiles where id = '00000000-0000-0000-0007-000000000002') then
    raise exception 'owner 2: profiles row left';
  end if;
  if exists (select 1 from public.offers where owner_id = '00000000-0000-0000-0007-000000000002') then
    raise exception 'owner 2: offers left';
  end if;
  if exists (
    select 1 from public.invitations
    where owner_id = '00000000-0000-0000-0007-000000000002'
       or offer_id = '00000000-0000-0000-0007-000000000105'
  ) then
    raise exception 'owner 2: invitations left';
  end if;
  -- Agent D keeps the account and the pending invitation to O3.
  if not exists (select 1 from public.profiles where id = '00000000-0000-0000-0007-000000000014') then
    raise exception 'owner 2 deleted: agent D profile missing';
  end if;
  if (select status from public.offers where id = '00000000-0000-0000-0007-000000000103') is distinct from 'invited' then
    raise exception 'owner 2 deleted: O3 should stay invited';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- No request.jwt.claims (no auth.uid()): not_found and nothing deleted.
-- ---------------------------------------------------------------------------------------------

create temporary table account_deletion_users_before as select count(*) as n from auth.users;

set local role authenticated;
set local request.jwt.claims = '';

do $$
declare res text;
begin
  if auth.uid() is not null then raise exception 'no claims: auth.uid() should be null'; end if;
  res := public.delete_own_account();
  if res is distinct from 'not_found' then raise exception 'no claims: expected not_found, got %', res; end if;
end $$;

-- A deleted user's session (the account no longer exists): not_found as well.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0007-000000000011","role":"authenticated"}';

do $$
declare res text;
begin
  res := public.delete_own_account();
  if res is distinct from 'not_found' then raise exception 'deleted user: expected not_found, got %', res; end if;
end $$;

reset role;

do $$
begin
  if (select count(*) from auth.users) is distinct from (select n from account_deletion_users_before) then
    raise exception 'no claims: users were deleted';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Function privileges.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if has_function_privilege('anon', 'public.delete_own_account()', 'execute') then
    raise exception 'anon must not execute delete_own_account';
  end if;
  if not has_function_privilege('authenticated', 'public.delete_own_account()', 'execute') then
    raise exception 'authenticated must execute delete_own_account';
  end if;
  if has_function_privilege('anon', 'public.restore_offer_on_invitation_delete()', 'execute') then
    raise exception 'anon must not execute restore_offer_on_invitation_delete';
  end if;
  if has_function_privilege('authenticated', 'public.restore_offer_on_invitation_delete()', 'execute') then
    raise exception 'authenticated must not execute restore_offer_on_invitation_delete';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The one-off repair query from the migration, re-run on an orphaned offer.
-- ---------------------------------------------------------------------------------------------

update public.offers set status = 'in_progress' where id = '00000000-0000-0000-0007-000000000106';

update public.offers o
  set status = 'seeking_agent'
  where o.status in ('invited', 'in_progress')
    and not exists (
      select 1 from public.invitations i
      where i.offer_id = o.id and i.status in ('pending', 'accepted')
    );

do $$
begin
  if (select status from public.offers where id = '00000000-0000-0000-0007-000000000106') is distinct from 'seeking_agent' then
    raise exception 'repair: O6 should be seeking_agent';
  end if;
  -- O3 has an active invitation, so the repair leaves it invited.
  if (select status from public.offers where id = '00000000-0000-0000-0007-000000000103') is distinct from 'invited' then
    raise exception 'repair: O3 should stay invited';
  end if;
end $$;

\echo 'account-deletion: all checks passed'

rollback;
