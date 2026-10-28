<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Profil agenta i wspólny słownik

- **Plan**: context/changes/agent-profile/plan.md
- **Mode**: Deep
- **Date**: 2026-10-28
- **Verdict**: SOUND
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
9/9 paths ✓, 6/6 symbols ✓ (ROLES, navFor, isActive, useNativeSubmitting, SubmitButton, ServerError, db:types), brief↔plan ✓, Progress↔Phase ✓ (4+1, 3+1, 3+7). Potwierdzone: `revoke all` + `grant select` w `create_profiles.sql:20-22` (grant kolumnowy faktycznie blokuje `role`), middleware przekierowuje właściciela z `/agent/*` na `/owner`, smoke ma osobne jary cookies i wysyła `Origin`.

## Findings

### F1 — Polecenie z kryterium 1.2 nie zadziała lokalnie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Success Criteria / Skrypt sprawdzający schemat
- **Detail**: Kryterium używało `psql`, którego lokalnie nie ma; wariant zapasowy miał placeholder `supabase_db_<project_id>`.
- **Fix**: Główne polecenie `docker exec -i supabase_db_10x-astro-starter psql -U postgres -v ON_ERROR_STOP=1 < …`; `psql` jako alternatywa.
- **Decision**: FIXED

### F2 — FormField nie przyjmuje inputMode

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 — Formularz
- **Detail**: `FormFieldProps` (`src/components/auth/FormField.tsx:8-21`) nie ma `inputMode`, `icon` jest wymagany; plik nie był na liście zmian.
- **Fix**: Dodano `FormField.tsx` do Fazy 3: opcjonalny `inputMode`, ikony `Banknote` / `Briefcase`.
- **Decision**: FIXED

### F3 — Brak pola liczbowego w formData nie jest obsłużony

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Serwis i Smoke
- **Detail**: `formData.get()` zwraca `null` dla brakującego klucza, a schemat obsługiwał tylko `""`; krok smoke „niepełny” nie określał wysyłanych pól; nie było powiedziane, że update zastępuje wszystkie 5 kolumn.
- **Fix**: `null` i `""` (po trim) → `null`; smoke wysyła puste stringi; zdanie o zastępowaniu 5 kolumn.
- **Decision**: FIXED

### F4 — Oczekiwane błędy w skrypcie SQL przerwą transakcję

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Skrypt sprawdzający schemat
- **Detail**: Przypadki „odrzucone” i „update role” rzucają błąd, który przy `ON_ERROR_STOP` i jednej transakcji zatrzyma skrypt.
- **Fix**: Wzorzec `do $$ begin …; raise exception 'expected failure'; exception when check_violation or insufficient_privilege then null; end $$` + `get diagnostics`.
- **Decision**: FIXED

### F5 — Zmiana isActive opisana jako „albo–albo”

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 — Nawigacja i panel
- **Detail**: Plan zostawiał wybór miejsca zmiany; `isActive` wołają Sidebar, MobileNav i Dock.
- **Fix**: `isActive` w `nav.ts`: dokładne porównanie dla `Object.values(ROLE_PREFIXES)`, w pozostałych przypadkach `matchesPrefix`.
- **Decision**: FIXED

### F6 — Sprzeczny opis ścieżki „brak klienta” w endpoincie

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Endpoint
- **Detail**: Ten sam punkt kierował brak klienta raz na `/auth/signin`, raz na `?error=unavailable`.
- **Fix**: Brak klienta → `/agent/profile?error=unavailable`; brak użytkownika → `/auth/signin`.
- **Decision**: FIXED
