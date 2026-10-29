<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Account deletion (S-07)

- **Plan**: context/changes/account-deletion/plan.md
- **Mode**: Deep
- **Date**: 2026-10-28
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Grounding: 9/9 paths ✓, 6/6 symbols ✓, brief↔plan ✓

## Findings

### F1 — Warunek wstępny z produkcji sprawdzany dopiero po fazie 1

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details / Phase 1, Manual 1.6
- **Detail**: Plan każe sprawdzić `has_table_privilege('postgres','auth.users','DELETE')` przed fazą 1, a `false` zatrzymuje całe podejście. Krok 1.6 jest jednak ręczną weryfikacją fazy 1, więc /10x-implement zapyta o niego dopiero po napisaniu migracji, testu i typów.
- **Fix**: Sprawdzić teraz, wynik wpisać do Current State Analysis, a 1.6 oznaczyć jako zrobione przy commicie fazy 1.
- **Decision**: FIXED (Fix in plan)

### F2 — Endpoint nie obsługuje braku wiersza w profiles

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Endpoint
- **Detail**: Kontrakt opisuje tylko „brak klienta albo błąd odczytu roli”, a pomija `data === null`. Wtedy `homeFor(undefined)` buduje błędny URL. Wzorzec w `src/pages/api/owner/invitations.ts:35-38` rozdziela błąd i brak wiersza.
- **Fix**: Brak profilu traktować jak błąd odczytu roli (redirect `/dashboard?error=unavailable`).
- **Decision**: FIXED (Fix in plan)

### F3 — NFR „nie zostają żadne dane” a dziennik audytu Supabase Auth

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Overview / Current State Analysis (prd.md:103)
- **Detail**: Usunięcie z `auth.users` nie czyści `auth.audit_log_entries`, a jego wpisy (jeśli dziennik w bazie jest włączony) zawierają e-mail. Granica „dane w produkcie” kontra „logi platformy” nie została rozstrzygnięta.
- **Fix**: Dopisać świadomą decyzję: logi platformy Supabase są poza zakresem NFR i wygasają według retencji Supabase. Warto ją wpisać do „Decyzji, które należą do mnie” w raporcie architekta.
  - Strength: Zero kodu, decyzja jest jawna.
  - Tradeoff: Ścisłe odczytanie NFR nie jest spełnione w 100%.
  - Confidence: MED — nie sprawdzono, czy produkcja zapisuje audit log w bazie.
  - Blind spot: Retencja logów na planie Free.
- **Decision**: FIXED (Fix in plan)
