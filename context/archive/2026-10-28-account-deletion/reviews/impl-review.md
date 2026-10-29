<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Account deletion (S-07)

- **Plan**: context/changes/account-deletion/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Automated verification (2026-10-28)

| Check | Result |
|-------|--------|
| `npx supabase migration list --local` | `20261028220000` applied |
| `supabase/tests/*.sql` (5 files, as in CI) | all checks passed |
| `npm run lint` | 0 errors, 0 warnings |
| `npx astro check` | 0 errors |
| `npm run db:types` + `git diff --exit-code src/db/database.types.ts` | no diff |
| `gh run list --branch main` | CI run for PR #15 merge: success |
| Production `POST /api/account/delete` without a session | 302 → `/auth/signin` |
| Production `GET /?deleted=1` | shows "Konto zostało usunięte razem z Twoimi danymi." |

## Findings

### F1 — Kroki produkcyjne 3.4–3.6 odhaczone bez zapisanych wyników

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/account-deletion/plan.md (Progress 3.4–3.6)
- **Detail**: Plan wymaga pokazania wyniku `db push --dry-run`, liczby osieroconych ofert przed i po `db push` (ma być 0) oraz testu usunięcia kont w UI na produkcji. W planie, w commitach i w epilogu (35ebd17) nie ma tych wyników, tylko `[x]`. Lekcja „Odhaczaj krok ręczny dopiero po zobaczeniu stanu” wymaga dowodu; sprawdzenie produkcji przez curl (tabela wyżej) potwierdza tylko endpoint i komunikat, nie stan bazy.
- **Fix**: Dopisać w planie sekcję „Addendum — weryfikacja produkcyjna” z wynikiem dry-run, liczbą osieroconych ofert przed/po i datą testu UI.
- **Decision**: FIXED — Addendum w planie (migracja na produkcji potwierdzona, osierocone oferty = 0, test UI 2026-10-28; dry-run i liczba sprzed db push niezapisane)

### F2 — Ścieżka `unavailable` w endpoincie kończy się bez komunikatu

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/account/delete.ts:14
- **Detail**: Przy błędzie odczytu roli endpoint przekierowuje na `/dashboard?error=unavailable`, a `src/pages/dashboard.ts:12` gubi parametr. Gdy błąd był chwilowy (middleware przy drugim odczycie dostaje profil), użytkownik ląduje w panelu bez informacji, że konto nie zostało usunięte. Plan świadomie przyjął „komunikatu nie pokazujemy”, więc to wada planu, nie implementacji. Middleware na ten sam błąd robi `/auth/signin?error=unavailable` (`src/middleware.ts:37`).
- **Fix**: Przekierować na `/auth/signin?error=unavailable`, jak middleware przy tym samym błędzie.
- **Decision**: FIXED

### F3 — Test SQL nie pokrywa właściciela z zaproszeniem `accepted`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/account-deletion.sql:148-185
- **Detail**: Właściciel 2 ma tylko zaproszenie `pending`. Brak przypadku, w którym właściciel usuwa konto z ofertą `in_progress` (kaskada oferta → zaproszenie `accepted` → trigger z `update` na 0 wierszy). Plan opisuje ten przypadek w Critical Implementation Details jako sprawdzony ręcznie.
- **Fix**: Dodać właścicielowi 2 ofertę `in_progress` z zaproszeniem `accepted` i sprawdzić, że usunięcie przechodzi bez błędu i nie zostawia wierszy.
- **Decision**: FIXED (O7 w teście)

### F4 — Odwrotna kolejność blokad trigger vs. RPC zaproszeń

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261028220000_account_deletion.sql:18-22
- **Detail**: Trigger blokuje zaproszenie → ofertę, a `invite_agent`/`respond_to_invitation` ofertę → zaproszenie. Równoległe operacje na tej samej ofercie mogą skończyć się deadlockiem; Postgres przerwie jedną transakcję, endpoint zwróci `error=unknown`, ponowienie działa, dane zostają spójne. Testy współbieżności są w „What We're NOT Doing”.
- **Fix**: Zaakceptować ryzyko; opcjonalnie jedna linia komentarza w kolejnej migracji.
- **Decision**: SKIPPED (ryzyko zaakceptowane; współbieżność poza zakresem)

### F5 — `ROLE_LABELS` zduplikowane

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/account/AccountCard.astro:15
- **Detail**: Ta sama mapa `{ owner: "Właściciel", agent: "Agent" }` jest w `src/components/shell/AppTopbar.astro:17`.
- **Fix**: Przenieść `ROLE_LABELS` do `src/types.ts` (albo `src/lib/route-guard.ts`) i importować w obu miejscach.
- **Decision**: FIXED (ROLE_LABELS w src/lib/dictionaries.ts, obok pozostałych etykiet)

### F6 — Roadmapa: S-07 nadal `in-progress` po merge

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/roadmap.md (S-07)
- **Detail**: Faza 1 zmieniła status S-07 z `proposed` na `in-progress`; po wdrożeniu nikt nie ustawił `done`.
- **Fix**: Ustawić S-07 na `done` w commicie archiwizacji.
- **Decision**: FIXED (S-07 → done w tabeli, sekcji slice'a i tabeli następnych kroków)

## Triage summary (2026-10-29)

| Decision | Findings |
|----------|----------|
| Fixed | F1, F2, F3, F5, F6 (5) |
| Skipped | F4 (1) |
