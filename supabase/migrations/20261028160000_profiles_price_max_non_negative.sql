-- profiles.price_max must not be negative on its own: profiles_price_range_ordered passes
-- when price_min is null, so price_max = -1 slipped through (S-02 impl-review, F2).

alter table public.profiles
  add constraint profiles_price_max_non_negative check (price_max >= 0);

-- down:
-- alter table public.profiles drop constraint if exists profiles_price_max_non_negative;
