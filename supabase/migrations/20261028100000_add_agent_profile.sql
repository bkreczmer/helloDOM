-- Agent profile fields on public.profiles: cities, property types, price range, experience.
-- Owners keep these columns empty; profile_complete tells whether an agent can be ranked.
-- Slugs in the cities and property_types checks must match src/lib/dictionaries.ts.
-- Editing goes through a column-level grant: authenticated may update only these five
-- columns, so role (and id, created_at) stays immutable even with an update policy in place.

alter table public.profiles
  add column cities text[] not null default '{}',
  add column property_types text[] not null default '{}',
  add column price_min integer,
  add column price_max integer,
  add column experience_years integer;

alter table public.profiles
  add constraint profiles_cities_in_dictionary check (
    cities <@ array[
      'bialystok', 'bydgoszcz', 'gdansk', 'gorzow-wielkopolski', 'katowice', 'kielce',
      'krakow', 'lublin', 'lodz', 'olsztyn', 'opole', 'poznan', 'rzeszow', 'szczecin',
      'torun', 'warszawa', 'wroclaw', 'zielona-gora'
    ]::text[]
  ),
  add constraint profiles_property_types_in_dictionary check (
    property_types <@ array['apartment', 'house', 'plot']::text[]
  ),
  add constraint profiles_price_min_non_negative check (price_min >= 0),
  -- A null on either side passes; completeness is tracked by profile_complete.
  add constraint profiles_price_range_ordered check (price_max >= price_min),
  add constraint profiles_experience_years_range check (experience_years between 0 and 60);

alter table public.profiles
  add column profile_complete boolean generated always as (
    cardinality(cities) >= 1
    and cardinality(property_types) >= 1
    and price_min is not null
    and price_max is not null
    and experience_years is not null
  ) stored;

-- Column-level grant: no update on role, id, created_at or the generated column.
grant update (cities, property_types, price_min, price_max, experience_years)
  on public.profiles to authenticated;

-- Only agents edit their own row; an owner's update matches no rows.
create policy profiles_update_own_agent on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id and role = 'agent')
  with check ((select auth.uid()) = id and role = 'agent');

-- down:
-- drop policy if exists profiles_update_own_agent on public.profiles;
-- revoke update (cities, property_types, price_min, price_max, experience_years)
--   on public.profiles from authenticated;
-- alter table public.profiles
--   drop column if exists profile_complete,
--   drop column if exists cities,
--   drop column if exists property_types,
--   drop column if exists price_min,
--   drop column if exists price_max,
--   drop column if exists experience_years;
