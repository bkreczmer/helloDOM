<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Testy rankingu top 3 i izolacji danych

- **Plan**: context/changes/testing-ranking-and-isolation/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria re-run on 2026-10-29: `npm run test:integration` 24/24, 0 kont `it-*` po przebiegu, blokada hosta działa, `supabase/tests/*.sql` 6/6, `npm run lint` i `npx astro check` 0 błędów, PR #19 `ci` i `smoke` zielone (log kroku: R1–R8, I1–I16). Krok ręczny 1.7 potwierdzony przez użytkownika w czacie.

## Findings

### F1 — `.env.test` / `.env.local` czytane przez Vitest, a niechronione przez `.gitignore`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: vitest.config.ts:7, .gitignore:17-18
- **Detail**: Vitest działa w trybie `test`, więc `loadEnv(mode, cwd, "")` czyta też `.env.local`, `.env.test` i `.env.test.local`. `.gitignore` obejmuje tylko `.env` i `.env.production`. Strażnik hosta nie uruchomi testów na produkcji, ale plik `.env.test` z kluczami dałoby się zacommitować do publicznego repo (twarda zasada: nigdy sekretów w repo).
- **Fix**: Dodać do `.gitignore` `.env.*` z wyjątkiem `!.env.example`.
- **Decision**: FIXED (.gitignore: .env.* + !.env.example)

### F2 — I16 akceptuje martwą gałąź `[]`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/isolation.test.ts:217-228
- **Detail**: Migracje robią `revoke all ... from anon` na `offers` (`create_offers.sql:41`) i `profiles` (`create_profiles.sql:20`), więc dziś zawsze wychodzi `42501`. Gałąź `else` (pusta tablica) jest zgodna z planem, ale test nie zauważy, gdy ktoś przypadkiem nada `anon` grant select (wtedy RLS dałoby `[]` i test przeszedłby).
- **Fix**: Zostawić tylko `expect(error?.code).toBe("42501")` i `expect(data).toBeNull()`, z komentarzem, że anon nie ma grantu.
- **Decision**: FIXED (tylko 42501 + data null; break-check grant select to anon → czerwony)

### F3 — Adaptacja R8 niezapisana w planie

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/integration/ranking.test.ts:140-161
- **Detail**: Plan: „O zaprasza A2 na ofercie R1 … R1 nadal A2, A1, A3”. Kod tworzy dwie świeże oferty z parametrami R1 (zaproszenie i odrzucenie na jednej, druga musi dać `R1_TOP`). Intencja zachowana, testy niezależne od kolejności, ale odstępstwo istnieje tylko w czacie.
- **Fix**: Dopisać Addendum w plan.md (R8 na dwóch świeżych ofertach; CI z `--reporter=verbose` pod kryterium 3.4).
- **Decision**: FIXED (Addendum w plan.md)

### F4 — Cookbook nie mówi o restarcie po zmianie limitu auth i o pozostałościach smoke

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: context/foundation/test-plan.md §6.5, tests/integration/helpers.ts:131-135
- **Detail**: `sign_in_sign_ups = 100` działa lokalnie dopiero po `npx supabase stop && npx supabase start`; na starym stacku drugi przebieg dostanie 429. Komunikat strażnika podpowiada usunięcie tylko `it-%@example.com`, a w tych samych miastach mogą leżeć konta `smoke-%@example.com`.
- **Fix**: Dopisać w §6.5 zdanie o restarcie; w komunikacie strażnika `email like 'it-%@example.com' or email like 'smoke-%@example.com'`.
- **Decision**: FIXED (§6.5 + komunikat strażnika)

### F5 — Testy integracyjne przed tanim sprawdzeniem `db:types`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .github/workflows/ci.yml:50-55
- **Detail**: Gdy testy integracyjne padną, rozjazd typów nie zostanie zgłoszony w tym samym przebiegu. Kolejność była narzucona przez plan (po testach SQL, przed typami); kosmetyka.
- **Fix**: Bez zmian albo przenieść krok za `Check generated database types are up to date`.
- **Decision**: SKIPPED
