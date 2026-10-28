<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Profil agenta i wspólny słownik

- **Plan**: context/changes/agent-profile/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria evidence (2026-10-28): `supabase/tests/agent-profile.sql` locally → "all checks passed"; `npx astro check` 0/0/0; `npm run lint` clean; `npm run db:types` → no diff; PR #6 `ci` + `smoke` pass (incl. `Run database tests`); main CI after merge success; prod `/agent/profile` anon → 302 `/auth/signin`. `db reset` not rerun locally (wipes accounts) — covered by fresh Supabase in CI smoke.

## Findings

### F1 — Typ `Profile` obiecuje kolumny, których middleware nie pobiera

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/types.ts:15, src/middleware.ts:31,45
- **Detail**: Po regeneracji typów `Profile = Omit<ProfileRow,"role"> & {role}` zawiera `cities`, `price_min`, `profile_complete` itd. Middleware wybiera tylko `id, role, created_at` i rzutuje `data as Profile`, więc `locals.profile.cities` ma typ `string[]`, a w runtime jest `undefined`. Dziś używane jest tylko `.role`; pułapka dla S-03/S-04.
- **Fix**: Zawęzić typ: `export type Profile = Pick<ProfileRow, "id" | "created_at"> & { role: Role };`.
- **Decision**: FIXED

### F2 — Baza przepuszcza ujemne `price_max` (gdy `price_min` null) i duplikaty w tablicach

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261028100000_add_agent_profile.sql:15-28
- **Detail**: `profiles_price_min_non_negative` dotyczy tylko min, a `price_range_ordered` przepuszcza null, więc `price_max = -5` przy `price_min = null` przechodzi. `<@` dopuszcza `'{krakow,krakow}'`. Zod blokuje oba przypadki, ale zapis bezpośrednio przez PostgREST z JWT agenta go omija. Dziś bez skutków (profil niepełny; `= any(cities)` odporne na duplikaty); ryzyko, jeśli scoring w S-03 policzy `cardinality`.
- **Fix A ⭐ Recommended**: Dopisać `check (price_max >= 0)` do migracji S-03 (oferty) + asercję w `supabase/tests/agent-profile.sql`; w planie S-03 zapisać regułę „scoring nie liczy elementów tablic profilu”.
  - Strength: Bez osobnego `db push` na produkcję teraz; S-03 i tak dodaje migrację.
  - Tradeoff: Luka zostaje otwarta do S-03 (bez realnego skutku).
  - Confidence: HIGH — dziś żaden kod nie czyta `price_max` poza profilem.
  - Blind spot: Trzeba pamiętać o tym w planie S-03.
- **Fix B**: Nowa migracja teraz (`price_max >= 0` + check bez duplikatów przez funkcję immutable) i `db push` przed kolejnym merge.
  - Strength: Baza od razu = zod.
  - Tradeoff: Osobny mini-PR, `db push --dry-run` + `db push` na produkcji; check duplikatów wymaga funkcji.
  - Confidence: MED — funkcja w check constraint to dodatkowa złożoność.
  - Blind spot: Czy produkcja ma już wiersze z duplikatami (raczej nie).
- **Decision**: FIXED via Fix A (queued to follow-ups/review-fixes.md for S-03)

### F3 — Endpoint nie sprawdza, czy `update` zmienił wiersz

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/agent/profile.ts:44-57
- **Detail**: Gdy RLS lub brak wiersza da 0 zmienionych wierszy, użytkownik dostaje `?saved=1`. Dziś wyklucza to wcześniejsze sprawdzenie roli (rola niezmienna), ale cichy sukces byłby mylący przy zmianie polityki.
- **Fix**: Dodać `.select("id")` po `.eq(...)` i przy pustym `data` zwrócić `fail("unknown")`.
- **Decision**: FIXED

### F4 — Błąd walidacji serwera gubi wpisane dane

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/agent/profile.ts:36-39, src/pages/agent/profile.astro:36
- **Detail**: Redirect `?error=invalid_input` przeładowuje formularz z bazy. Spójne z auth i praktycznie nieosiągalne, bo walidacja klienta ma te same reguły — dotyczy tylko obejścia JS.
- **Fix**: Bez zmian — zaakceptować (walidacja klienta = serwer).
- **Decision**: SKIPPED
