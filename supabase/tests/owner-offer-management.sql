-- Schema checks for owner offer management (migration 20261029100000_owner_offer_management.sql):
-- the owner's update depending on the offer status, the columns without an update grant, no update
-- or delete of someone else's offer (second owner, invited agent), deleting an 'in_progress' offer
-- with its invitations, and no write grants for anon.
-- Runs in one transaction and rolls back, so it leaves no data behind.
-- Local: docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/owner-offer-management.sql
-- Expected failures are caught inside do blocks; any other exception stops the script.

\set ON_ERROR_STOP on

begin;

-- The on_auth_user_created trigger creates the profiles rows.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0008-000000000001', 'owner-1@owner-offer-management.test', '{"role":"owner"}'),
  ('00000000-0000-0000-0008-000000000002', 'owner-2@owner-offer-management.test', '{"role":"owner"}'),
  ('00000000-0000-0000-0008-000000000011', 'agent-a@owner-offer-management.test', '{"role":"agent"}'),
  ('00000000-0000-0000-0008-000000000012', 'agent-b@owner-offer-management.test', '{"role":"agent"}');

-- Offers and invitations are inserted directly as postgres, with statuses that match:
--   O1 (owner 1): seeking_agent;
--   O2 (owner 1): invited, agent A pending;
--   O3 (owner 1): in_progress, agent B rejected and agent A accepted;
--   O4 (owner 2): seeking_agent, untouched by owner 1's delete.
insert into public.offers (id, owner_id, city, property_type, transaction, price, status) values
  ('00000000-0000-0000-0008-000000000101', '00000000-0000-0000-0008-000000000001', 'rzeszow', 'apartment', 'sale', 500000, 'seeking_agent'),
  ('00000000-0000-0000-0008-000000000102', '00000000-0000-0000-0008-000000000001', 'rzeszow', 'apartment', 'sale', 500000, 'invited'),
  ('00000000-0000-0000-0008-000000000103', '00000000-0000-0000-0008-000000000001', 'rzeszow', 'apartment', 'sale', 500000, 'in_progress'),
  ('00000000-0000-0000-0008-000000000104', '00000000-0000-0000-0008-000000000002', 'rzeszow', 'apartment', 'sale', 500000, 'seeking_agent');

insert into public.invitations (offer_id, agent_id, owner_id, status, responded_at) values
  ('00000000-0000-0000-0008-000000000102', '00000000-0000-0000-0008-000000000011', '00000000-0000-0000-0008-000000000001', 'pending', null),
  ('00000000-0000-0000-0008-000000000103', '00000000-0000-0000-0008-000000000012', '00000000-0000-0000-0008-000000000001', 'rejected', now()),
  ('00000000-0000-0000-0008-000000000103', '00000000-0000-0000-0008-000000000011', '00000000-0000-0000-0008-000000000001', 'accepted', now());

set local role authenticated;

-- ---------------------------------------------------------------------------------------------
-- Owner 1 updates own offers: only 'seeking_agent' is editable.
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000001","role":"authenticated"}';

do $$
declare n integer;
begin
  update public.offers
    set price = 550000, area_m2 = 54.5, rooms = 3, description = 'Nowy opis'
    where id = '00000000-0000-0000-0008-000000000101';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'owner 1 on seeking_agent O1: expected 1 updated row, got %', n; end if;
  if (select price from public.offers where id = '00000000-0000-0000-0008-000000000101') is distinct from 550000 then
    raise exception 'owner 1 on seeking_agent O1: new price not saved';
  end if;
end $$;

do $$
declare n integer;
begin
  update public.offers set price = 1 where id = '00000000-0000-0000-0008-000000000102';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'owner 1 on invited O2: expected 0 updated rows, got %', n; end if;

  update public.offers set price = 1 where id = '00000000-0000-0000-0008-000000000103';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'owner 1 on in_progress O3: expected 0 updated rows, got %', n; end if;
end $$;

-- The values pass the policy's with check, so only the missing column grant stops these updates.
do $$ begin
  update public.offers set status = 'seeking_agent' where id = '00000000-0000-0000-0008-000000000101';
  raise exception 'expected failure: update of status';
exception when insufficient_privilege then null; end $$;

do $$ begin
  update public.offers set owner_id = '00000000-0000-0000-0008-000000000001' where id = '00000000-0000-0000-0008-000000000101';
  raise exception 'expected failure: update of owner_id';
exception when insufficient_privilege then null; end $$;

do $$
declare v_column text;
begin
  foreach v_column in array array['id', 'owner_id', 'status', 'created_at'] loop
    if has_column_privilege('authenticated', 'public.offers', v_column, 'update') then
      raise exception 'authenticated must not update offers.%', v_column;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Owner 2 cannot update or delete owner 1's offer.
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000002","role":"authenticated"}';

do $$
declare n integer;
begin
  update public.offers set price = 1 where id = '00000000-0000-0000-0008-000000000101';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'owner 2 update on O1: expected 0 updated rows, got %', n; end if;

  delete from public.offers where id = '00000000-0000-0000-0008-000000000101';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'owner 2 delete on O1: expected 0 deleted rows, got %', n; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Agent A reads O2 and O3 through the invitations, but cannot update or delete them (nor O1).
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000011","role":"authenticated"}';

do $$
declare n integer;
begin
  if (select count(*) from public.offers where id in (
    '00000000-0000-0000-0008-000000000102', '00000000-0000-0000-0008-000000000103'
  )) <> 2 then
    raise exception 'agent A: expected to read O2 and O3';
  end if;

  update public.offers set price = 1
    where id in (
      '00000000-0000-0000-0008-000000000101', '00000000-0000-0000-0008-000000000102',
      '00000000-0000-0000-0008-000000000103'
    );
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'agent A update: expected 0 updated rows, got %', n; end if;

  delete from public.offers
    where id in (
      '00000000-0000-0000-0008-000000000101', '00000000-0000-0000-0008-000000000102',
      '00000000-0000-0000-0008-000000000103'
    );
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'agent A delete: expected 0 deleted rows, got %', n; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Owner 1 deletes the in_progress O3 with an accepted and a rejected invitation.
-- ---------------------------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0008-000000000001","role":"authenticated"}';

do $$
declare n integer;
begin
  delete from public.offers where id = '00000000-0000-0000-0008-000000000103';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'owner 1 delete on in_progress O3: expected 1 deleted row, got %', n; end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- anon has no write grants.
-- ---------------------------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '';

do $$ begin
  delete from public.offers where id = '00000000-0000-0000-0008-000000000101';
  raise exception 'expected failure: anon delete';
exception when insufficient_privilege then null; end $$;

do $$ begin
  update public.offers set price = 1 where id = '00000000-0000-0000-0008-000000000101';
  raise exception 'expected failure: anon update';
exception when insufficient_privilege then null; end $$;

reset role;

-- As postgres: O3 and its invitations are gone, the other offers and O2's invitation stay.
do $$
begin
  if exists (select 1 from public.offers where id = '00000000-0000-0000-0008-000000000103') then
    raise exception 'O3 deleted: offers row left';
  end if;
  if exists (select 1 from public.invitations where offer_id = '00000000-0000-0000-0008-000000000103') then
    raise exception 'O3 deleted: invitations left';
  end if;
  if (select count(*) from public.offers where id in (
    '00000000-0000-0000-0008-000000000101', '00000000-0000-0000-0008-000000000102',
    '00000000-0000-0000-0008-000000000104'
  )) <> 3 then
    raise exception 'O1, O2 and O4 should stay';
  end if;
  if (select status from public.offers where id = '00000000-0000-0000-0008-000000000102') is distinct from 'invited' then
    raise exception 'O2 should stay invited';
  end if;
  if (select price from public.offers where id = '00000000-0000-0000-0008-000000000102') is distinct from 500000 then
    raise exception 'O2 price should stay 500000';
  end if;
  if not exists (
    select 1 from public.invitations
    where offer_id = '00000000-0000-0000-0008-000000000102' and status = 'pending'
  ) then
    raise exception 'O2 pending invitation missing';
  end if;
end $$;

\echo 'owner-offer-management: all checks passed'

rollback;
