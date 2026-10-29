<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Test E2E ścieżki krytycznej (rollout Phase 2)

- **Plan**: context/changes/testing-critical-path-e2e/plan.md
- **Mode**: Deep (weryfikacja kodu inline, bez sub-agenta)
- **Date**: 2026-10-29
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
7/7 paths ✓, 8/8 symbols ✓ (`rank_agents_for_offer`, `offers_select_own`, `edit_locked`, `already_responded`, `aria-label="Zaproś agenta N"`, komunikat „mniej niż 3”, `assertCitiesEmpty`, `sign_in_sign_ups = 100`), brief↔plan ✓, Progress↔Fazy ✓.

Wyrocznia (P 100, T1 85, T2 85, F 65, Y 70, Z 0; I i O poza rankingiem) zgadza się z formułą w `supabase/migrations/20261028200000_invitation_response.sql:33-53`. Miasta E2E nie kolidują z integracją (`opole`, `torun`, `kielce`). Build w CI trwa 4 s, więc podwójny build nie grozi timeoutem `webServer`.

## Findings

### F1 — Trace nie powstanie przy porażce (on-first-retry bez retries)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 1 §2; kroki 2.7 i 3.4
- **Detail**: `trace: "on-first-retry"` bez ustalonego `retries`: bez retry trace nie powstaje, więc krok 2.7 nie ma czego otworzyć, a artefakt z 3.4 przychodzi bez trace.
- **Fix**: `trace: "retain-on-failure"`, `retries: 0`; w 2.7 uruchomić z `--trace on`.
- **Decision**: FIXED

### F2 — Drugi test() zależy od kroku 3 pierwszego (describe.serial)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 2 §2 krok 3; §3 „#1 filtr 0”
- **Detail**: A2 powstawała w kroku 3 testu 1. Gdy test 1 padnie wcześniej, serial pomija test 2. Wariant uszkodzenia z `RankingList.astro` czerwienił krok 2 testu 1, a nie test 2.
- **Fix**: A2 zakładana w `beforeAll` przez `POST /api/owner/offers` z `Origin`, krok 3 usunięty; uszkodzenie „filtr 0” tylko przez tymczasową migrację.
- **Decision**: FIXED

### F3 — Uszkodzenie #3: w invitations.ts nie ma „mapowania” do zamiany

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 2 §3, „#3 status”
- **Detail**: Endpoint przekazuje `response` prosto do RPC (`src/pages/api/agent/invitations.ts:50-53`). Pierwsza czerwień to URL `?accepted=1`, a nie stan bazy.
- **Fix**: uszkodzenie jako `p_response: response === "accept" ? "reject" : "accept"`; czerwień w kroku 7 (URL, potem stan bazy).
- **Decision**: FIXED
