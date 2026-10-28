-- Invitation response (S-06): invitations.responded_at, respond_to_invitation: the single write
-- path for an agent's answer to own invitation, and rank_agents_for_offer without the agents who
-- rejected an invitation to the offer.
-- authenticated still gets select only on invitations: no insert, update or delete grants.

alter table public.invitations add column responded_at timestamptz;

-- A pending invitation has no response date, an answered one always has it.
alter table public.invitations
  add constraint invitations_responded_at_matches_status
  check ((status = 'pending') = (responded_at is null));

-- Top 3 agents for one of the caller's offers. Security definer, because owners cannot read
-- agent profiles through RLS; the function therefore restricts the offer to the caller itself
-- and returns no rows (not an error) for someone else's or a missing offer.
-- Score: 35 for the property type + 35 for the price within [price_min, price_max]
-- + 3 per year of experience, capped at 10 years. Only complete agent profiles serving the
-- offer's city; a score of 0 is filtered out before the limit so it never takes a top 3 slot.
-- An agent who rejected an invitation to the offer is left out of its ranking for good, so
-- invite_agent returns agent_not_ranked for them and the next agent moves up into the top 3.
create or replace function public.rank_agents_for_offer(p_offer_id uuid)
returns table (agent_id uuid, score integer, experience_years integer, cities text[])
language sql
stable
security definer
set search_path = ''
as $$
  select r.agent_id, r.score, r.experience_years, r.cities
  from (
    select
      p.id as agent_id,
      (
        case when o.property_type = any (p.property_types) then 35 else 0 end
        + case when o.price between p.price_min and p.price_max then 35 else 0 end
        + 3 * least(p.experience_years, 10)
      )::integer as score,
      p.experience_years,
      p.cities,
      p.created_at
    from public.offers o
    join public.profiles p on o.city = any (p.cities)
    where o.id = p_offer_id
      and o.owner_id = (select auth.uid())
      and p.role = 'agent'
      and p.profile_complete
      and not exists (
        select 1 from public.invitations i
        where i.offer_id = o.id and i.agent_id = p.id and i.status = 'rejected'
      )
  ) r
  where r.score > 0
  order by r.score desc, r.experience_years desc, r.created_at asc, r.agent_id asc
  limit 3;
$$;

revoke execute on function public.rank_agents_for_offer(uuid) from public, anon;
grant execute on function public.rank_agents_for_offer(uuid) to authenticated;

-- The caller's answer to own invitation to p_offer_id, atomically for the invitation and the offer.
-- Returns a result code instead of raising, so the endpoint maps it to a redirect:
--   invalid_response  - p_response is neither 'accept' nor 'reject';
--   not_found         - no invitation of the caller to p_offer_id (also a missing offer,
--                       someone else's invitation and a call by the owner);
--   already_responded - the invitation is no longer pending, or the offer is not 'invited';
--   ok                - accept: invitation 'accepted', offer 'in_progress';
--                       reject: invitation 'rejected', offer back to 'seeking_agent';
--                       responded_at = now() in both cases.
-- The offer row is locked first and the invitation row second, in the same order as
-- invite_agent, so the two never deadlock. A second concurrent answer waits for the locks and
-- then sees a status other than 'pending', so it gets already_responded.
create function public.respond_to_invitation(p_offer_id uuid, p_response text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_offer_status text;
  v_invitation_id uuid;
  v_invitation_status text;
begin
  if p_response is null or p_response not in ('accept', 'reject') then
    return 'invalid_response';
  end if;

  select o.status into v_offer_status
  from public.offers o
  where o.id = p_offer_id
  for update;

  if not found then
    return 'not_found';
  end if;

  select i.id, i.status into v_invitation_id, v_invitation_status
  from public.invitations i
  where i.offer_id = p_offer_id
    and i.agent_id = (select auth.uid())
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_invitation_status <> 'pending' or v_offer_status <> 'invited' then
    return 'already_responded';
  end if;

  if p_response = 'accept' then
    update public.invitations set status = 'accepted', responded_at = now()
      where id = v_invitation_id;
    update public.offers set status = 'in_progress' where id = p_offer_id;
  else
    update public.invitations set status = 'rejected', responded_at = now()
      where id = v_invitation_id;
    update public.offers set status = 'seeking_agent' where id = p_offer_id;
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.respond_to_invitation(uuid, text) from public, anon;
grant execute on function public.respond_to_invitation(uuid, text) to authenticated;

-- down:
-- drop function if exists public.respond_to_invitation(uuid, text);
-- The previous rank_agents_for_offer, as in 20261028140000_create_offers.sql:
-- create or replace function public.rank_agents_for_offer(p_offer_id uuid)
-- returns table (agent_id uuid, score integer, experience_years integer, cities text[])
-- language sql
-- stable
-- security definer
-- set search_path = ''
-- as $$
--   select r.agent_id, r.score, r.experience_years, r.cities
--   from (
--     select
--       p.id as agent_id,
--       (
--         case when o.property_type = any (p.property_types) then 35 else 0 end
--         + case when o.price between p.price_min and p.price_max then 35 else 0 end
--         + 3 * least(p.experience_years, 10)
--       )::integer as score,
--       p.experience_years,
--       p.cities,
--       p.created_at
--     from public.offers o
--     join public.profiles p on o.city = any (p.cities)
--     where o.id = p_offer_id
--       and o.owner_id = (select auth.uid())
--       and p.role = 'agent'
--       and p.profile_complete
--   ) r
--   where r.score > 0
--   order by r.score desc, r.experience_years desc, r.created_at asc, r.agent_id asc
--   limit 3;
-- $$;
-- revoke execute on function public.rank_agents_for_offer(uuid) from public, anon;
-- grant execute on function public.rank_agents_for_offer(uuid) to authenticated;
-- alter table public.invitations drop constraint if exists invitations_responded_at_matches_status;
-- alter table public.invitations drop column if exists responded_at;
-- Offers left in 'in_progress' (and invitations left 'accepted' or 'rejected') stay as they are;
-- move them back by hand if needed.
