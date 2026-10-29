<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Owner offer management (S-04)

- **Plan**: context/changes/owner-offer-management/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated checks (2026-10-29): `npm run lint` 0, `npx astro check` 0 errors, `npm run build` OK, 6/6 `supabase/tests/*.sql` OK, `npm run smoke` (local) all passed, `gh pr checks 17` ci + smoke pass, CI on `main` success (merge #17), production `HTTP/2 200`.

## Findings

### F1 — Test SQL nie pokrywa statusu `draft` ani niezmienionej ceny dla `in_progress`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/owner-offer-management.sql:39-67
- **Detail**: Polityka `offers_update_own_editable` i `isOfferEditable` dopuszczają `draft`, ale żaden test tego nie sprawdza (szkicu nie da się dziś utworzyć, więc gałąź jest niesprawdzona). Dla O3 (`in_progress`) test sprawdza tylko 0 wierszy, a plan wymagał też „wartość bez zmian” (sprawdzone tylko dla O2, l.191).
- **Fix**: Dodać ofertę O5 `draft` (insert jako postgres) z asercją 1 wiersza przy update oraz asercję ceny O3 przed jej usunięciem.
- **Decision**: FIXED — O5 `draft` (1 wiersz, nowa cena) i asercja ceny O3 po nieudanym update; test przechodzi

### F2 — Dodatki spoza planu bez Addendum

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/owner/DeleteOffer.tsx:14-20, src/lib/services/offers.ts:135-146, 233-236, src/pages/owner/offers/[id]/edit.astro:50-58
- **Detail**: Uzasadnione, ale nieopisane w planie: `HINT_TEXT` (ostrzeżenie widoczne przed potwierdzeniem; smoke sprawdza ten tekst, nie tekst potwierdzenia z planu), `toOfferFormValues` w serwisie zamiast na stronie, `isOfferEditable`, nazwany typ `OfferFormValues`, redirect w `edit.astro` przez `Astro.response` (wzorzec z `src/pages/dashboard.ts`, ograniczenie lintera). Plan nie ma Addendum.
- **Fix**: Dopisać do planu sekcję „Addendum — odstępstwa od implementacji” z tymi pięcioma punktami.
- **Decision**: FIXED — sekcja „Addendum — odstępstwa od implementacji” w plan.md

### F3 — Wyjątek przy odczycie profilu/doczytaniu w update kończy się `unknown`, nie `unavailable`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/owner/offers/update.ts:91-92
- **Detail**: Plan: „błąd profilu lub doczytania → …/edit?error=unavailable”. Gdy Supabase zwraca `error` — zgodnie (l.36, l.84). Gdy zapytanie rzuci wyjątek (sieć), wspólny `catch` daje `unknown`. Ten sam wzorzec ma `invitations.ts`; różnica tylko w treści komunikatu.
- **Fix**: Zostawić (zgodne ze wzorcem repo) albo zmienić kod w `catch` na `unavailable`.
- **Decision**: SKIPPED
