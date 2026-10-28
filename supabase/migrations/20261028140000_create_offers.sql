-- offers: a property owner's listing, and rank_agents_for_offer: the single place of the PRD score rule.
-- Slugs in the city, property_type and transaction checks must match src/lib/dictionaries.ts
-- (city list: the same as profiles_cities_in_dictionary in 20261028100000_add_agent_profile.sql).
-- Inserting goes through a column-level grant: owner_id, status, id and created_at always take
-- their defaults, so an owner cannot create an offer for someone else or skip the status flow.
-- No update or delete grants yet (S-04).

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  city text not null,
  property_type text not null,
  transaction text not null,
  price integer not null,
  area_m2 numeric(7, 2),
  rooms integer,
  description text,
  status text not null default 'seeking_agent',
  created_at timestamptz not null default now(),
  constraint offers_city_in_dictionary check (
    city = any (array[
      'bialystok', 'bydgoszcz', 'gdansk', 'gorzow-wielkopolski', 'katowice', 'kielce',
      'krakow', 'lublin', 'lodz', 'olsztyn', 'opole', 'poznan', 'rzeszow', 'szczecin',
      'torun', 'warszawa', 'wroclaw', 'zielona-gora'
    ]::text[])
  ),
  constraint offers_property_type_in_dictionary check (property_type in ('apartment', 'house', 'plot')),
  constraint offers_transaction_in_dictionary check (transaction in ('sale', 'rent')),
  constraint offers_price_positive check (price > 0),
  constraint offers_area_m2_positive check (area_m2 > 0),
  constraint offers_rooms_range check (rooms between 1 and 50),
  constraint offers_description_length check (char_length(description) <= 2000),
  constraint offers_status_valid check (status in ('draft', 'seeking_agent', 'invited', 'in_progress'))
);

create index offers_owner_id_created_at_idx on public.offers (owner_id, created_at desc);

alter table public.offers enable row level security;

-- Explicit grants so the result does not depend on the project's default privileges.
revoke all on public.offers from anon, authenticated;
grant select on public.offers to authenticated;
grant insert (city, property_type, transaction, price, area_m2, rooms, description)
  on public.offers to authenticated;
grant all on public.offers to service_role;

create policy offers_select_own on public.offers
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

-- Only owners add offers, and only for themselves (owner_id comes from the auth.uid() default).
create policy offers_insert_own_owner on public.offers
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'owner'
    )
  );

-- Top 3 agents for one of the caller's offers. Security definer, because owners cannot read
-- agent profiles through RLS; the function therefore restricts the offer to the caller itself
-- and returns no rows (not an error) for someone else's or a missing offer.
-- Score: 35 for the property type + 35 for the price within [price_min, price_max]
-- + 3 per year of experience, capped at 10 years. Only complete agent profiles serving the
-- offer's city; a score of 0 is filtered out before the limit so it never takes a top 3 slot.
create function public.rank_agents_for_offer(p_offer_id uuid)
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
  ) r
  where r.score > 0
  order by r.score desc, r.experience_years desc, r.created_at asc, r.agent_id asc
  limit 3;
$$;

revoke execute on function public.rank_agents_for_offer(uuid) from public, anon;
grant execute on function public.rank_agents_for_offer(uuid) to authenticated;

-- down:
-- drop function if exists public.rank_agents_for_offer(uuid);
-- drop table if exists public.offers;
