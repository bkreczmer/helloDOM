# Review fixes — agent-profile

Źródło: `reviews/impl-review.md` (2026-10-28).

## Do S-03 (offer-top3-ranking)

- [x] **F2 (Fix A)**: w migracji S-03 dodać `alter table public.profiles add constraint profiles_price_max_non_negative check (price_max >= 0);` i asercję w `supabase/tests/agent-profile.sql` (`price_max = -1` przy `price_min = null` → `check_violation`).
- [x] **F2 (reguła dla scoringu)**: baza dopuszcza duplikaty w `profiles.cities` i `profiles.property_types` (`<@` ich nie blokuje; zod usuwa je tylko w endpoincie). Scoring w S-03 nie może liczyć elementów tych tablic (`cardinality`, `array_length`), tylko sprawdzać przynależność (`= any(...)`, `@>`). Jeśli scoring będzie potrzebował liczby, najpierw dodać check bez duplikatów.

## Addendum (2026-10-28, po archiwizacji)

PR #7 z poprawkami F1 i F3 nie trafił do `main` przed archiwizacją S-02 i miał konflikt z przeniesionym folderem. Zastąpił go branch `fix/agent-profile-followups`: poprawki kodu z `05f9fce`, `reviews/impl-review.md` i ten plik dołożone do archiwum (odstępstwo od zasady „archiwum tylko do odczytu”; istniejących plików nie zmieniono).

- **F2 (Fix A)**: zamiast migracji S-03 osobna migracja `20261028160000_profiles_price_max_non_negative.sql` i asercja w `supabase/tests/agent-profile.sql`; break-check potwierdza, że bez constraintu asercja pada.
- **F2 (reguła dla scoringu)**: `rank_agents_for_offer` sprawdza przynależność (`= any (p.cities)`), nie liczy elementów tablic; `cardinality` występuje tylko w `profile_complete` (`>= 1`), gdzie duplikaty nie zmieniają wyniku.
