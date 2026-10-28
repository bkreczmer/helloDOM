# Review fixes — agent-profile

Źródło: `reviews/impl-review.md` (2026-10-28).

## Do S-03 (offer-top3-ranking)

- [ ] **F2 (Fix A)**: w migracji S-03 dodać `alter table public.profiles add constraint profiles_price_max_non_negative check (price_max >= 0);` i asercję w `supabase/tests/agent-profile.sql` (`price_max = -1` przy `price_min = null` → `check_violation`).
- [ ] **F2 (reguła dla scoringu)**: baza dopuszcza duplikaty w `profiles.cities` i `profiles.property_types` (`<@` ich nie blokuje; zod usuwa je tylko w endpoincie). Scoring w S-03 nie może liczyć elementów tych tablic (`cardinality`, `array_length`), tylko sprawdzać przynależność (`= any(...)`, `@>`). Jeśli scoring będzie potrzebował liczby, najpierw dodać check bez duplikatów.
