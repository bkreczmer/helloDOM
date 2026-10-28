-- invitations: an owner's invitation of one agent from the offer's top 3, and invite_agent:
-- the single write path for invitations and for moving an offer to 'invited'.
-- Statuses in the invitations check must match INVITATION_STATUSES in src/types.ts.
-- owner_id is denormalised from offers and set by invite_agent, so the invitations policies
-- never read offers: offers_select_invited_agent reads invitations, and a policy going back to
-- offers would cause "infinite recursion detected in policy".
-- authenticated gets select only: no insert, update or delete grants, and no update on
-- offers.status. Accepting and rejecting an invitation come in S-06.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  agent_id uuid not null references public.profiles (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint invitations_status_valid check (status in ('pending', 'accepted', 'rejected')),
  constraint invitations_offer_id_agent_id_key unique (offer_id, agent_id)
);

-- At most one active (pending or accepted) invitation per offer; this also covers the
-- "at most one accepted agent" guardrail for S-06.
create unique index invitations_one_active_per_offer on public.invitations (offer_id)
  where status in ('pending', 'accepted');

create index invitations_agent_id_created_at_idx on public.invitations (agent_id, created_at desc);

alter table public.invitations enable row level security;

-- Explicit grants so the result does not depend on the project's default privileges.
revoke all on public.invitations from anon, authenticated;
grant select on public.invitations to authenticated;
grant all on public.invitations to service_role;

create policy invitations_select_own_owner on public.invitations
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy invitations_select_own_agent on public.invitations
  for select
  to authenticated
  using (agent_id = (select auth.uid()));

-- An agent reads an offer only while holding a pending or accepted invitation to it.
-- Permissive, so it adds to offers_select_own.
create policy offers_select_invited_agent on public.offers
  for select
  to authenticated
  using (
    exists (
      select 1 from public.invitations i
      where i.offer_id = offers.id
        and i.agent_id = (select auth.uid())
        and i.status in ('pending', 'accepted')
    )
  );

-- Invites p_agent_id to one of the caller's offers and moves the offer to 'invited', atomically.
-- Returns a result code instead of raising, so the endpoint maps it to a redirect:
--   not_found        - no such offer, or the offer belongs to someone else (also for agents);
--   offer_locked     - the offer is not seeking an agent, or it already has an active invitation;
--   agent_not_ranked - p_agent_id is not in the offer's current top 3;
--   ok               - invitation inserted with owner_id = auth.uid(), offer status 'invited'.
-- The offer row is locked first, so two concurrent invitations queue up and the second one
-- sees 'invited'. The partial unique index is the second line of defence.
create function public.invite_agent(p_offer_id uuid, p_agent_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select o.status into v_status
  from public.offers o
  where o.id = p_offer_id
    and o.owner_id = (select auth.uid())
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_status <> 'seeking_agent' then
    return 'offer_locked';
  end if;

  -- rank_agents_for_offer applies its own owner gate with the same auth.uid().
  if not exists (
    select 1 from public.rank_agents_for_offer(p_offer_id) r
    where r.agent_id = p_agent_id
  ) then
    return 'agent_not_ranked';
  end if;

  begin
    insert into public.invitations (offer_id, agent_id, owner_id)
    values (p_offer_id, p_agent_id, (select auth.uid()));
  exception when unique_violation then
    return 'offer_locked';
  end;

  update public.offers set status = 'invited' where id = p_offer_id;

  return 'ok';
end;
$$;

revoke execute on function public.invite_agent(uuid, uuid) from public, anon;
grant execute on function public.invite_agent(uuid, uuid) to authenticated;

-- down:
-- drop function if exists public.invite_agent(uuid, uuid);
-- drop policy if exists offers_select_invited_agent on public.offers;
-- drop table if exists public.invitations;
-- Offers left in 'invited' must be moved back by hand:
-- update public.offers set status = 'seeking_agent' where status = 'invited';
