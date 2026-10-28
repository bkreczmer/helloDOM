<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Odpowiedź na zaproszenie

- **Plan**: context/changes/invitation-response/plan.md
- **Mode**: Deep
- **Date**: 2026-10-28
- **Verdict**: REVISE → SOUND (after triage)
- **Findings**: 2 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | WARNING |

## Grounding
Grounding: 12/12 paths ✓, 6/6 symbols ✓, brief↔plan ✓

## Findings

### F1 — Nowy check łamie istniejący test agent-invitation.sql

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 1 — Migracja / kryterium 1.2
- **Detail**: Check `(status = 'pending') = (responded_at is null)` odrzuca zapisy postgresa w `supabase/tests/agent-invitation.sql`: `:232` update na `rejected` bez `responded_at` (check_violation), a inserty `:262` (`accepted`) i `:273` (`rejected`) oczekują unique_violation, ale dostaną check_violation. Kryterium 1.2 i CI nie przejdą; Faza 1 nie wymienia tego pliku.
- **Fix**: Dopisać do Fazy 1 zmianę `supabase/tests/agent-invitation.sql`: `responded_at = now()` w `:232` i w insertach `:262`, `:273`.
- **Decision**: FIXED (Fix in plan)

### F2 — Smoke oczekuje „Zaproś” po odrzuceniu; w CI ranking jest pusty

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 3 — Smoke, krok 1
- **Detail**: Smoke tworzy jednego agenta (`scripts/smoke.mjs:111`, `:198`). W CI baza jest świeża, więc po wykluczeniu agenta smoke ranking oferty A jest pusty (`RankingList.astro:71`, bez formularza). Krok „zawiera formularz Zaproś” przejdzie lokalnie, a w CI padnie.
- **Fix**: Sprawdzać „Agent odrzucił zaproszenie” i bodyExcludes id agenta smoke, bez „Zaproś”; POST → `agent_not_ranked` zostaje jako dowód wykluczenia.
- **Decision**: FIXED (Fix in plan)

### F3 — `already_responded` po odrzuceniu ląduje na 404 bez komunikatu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Faza 2 — Endpoint, Strona oferty agenta, Smoke
- **Detail**: Redirect na `/agent/offers/{id}?error=already_responded` po odrzuceniu daje 404 (RLS ukrywa ofertę), a ServerError jest tylko w gałęzi „found”. Komunikat z Desired End State się nie pojawi; smoke sprawdza tylko Location.
- **Fix**: `already_responded` → 302 `/agent?error=already_responded`; w smoke zmienić Location i dodać GET z „Na to zaproszenie już odpowiedziano.”.
- **Decision**: FIXED (Fix in plan)

### F4 — SubmitButton nie obsłuży „Tak, odrzuć” (destructive)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Faza 2 — Wyspa odpowiedzi
- **Detail**: `SubmitButton` ma na sztywno `variant="accent"`, `w-full` i wymagany `icon` (`src/components/auth/SubmitButton.tsx:13`); plan chce wariantu destructive i zawijania przy 360 px.
- **Fix**: SubmitButton dostaje opcjonalne `variant` (domyślnie "accent") i `className` (domyślnie "w-full"); formularze auth bez zmian.
- **Decision**: FIXED (Fix in plan)

### F5 — Miejsce kroków smoke i prefiks UUID testu SQL

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 1 — Test SQL; Fazy 2–3 — Smoke
- **Detail**: Smoke kończy się blokiem signout (~`smoke.mjs:398-412`); nowe kroki muszą stać przed nim. Prefiks `0004-…` jest już używany w `agent-invitation.sql` (oferty).
- **Fix**: Dopisać „przed blokiem signout” i zmienić prefiks na `0005-…`.
- **Decision**: FIXED (Fix in plan)
