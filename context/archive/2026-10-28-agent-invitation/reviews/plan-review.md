<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Zaproszenie agenta

- **Plan**: context/changes/agent-invitation/plan.md
- **Mode**: Deep (weryfikacja kodu inline)
- **Date**: 2026-10-28
- **Verdict**: REVISE → SOUND po poprawkach
- **Findings**: 1 critical, 0 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | FAIL → PASS |
| Plan Completeness | PASS |

## Grounding
8/8 paths ✓, 4/4 symbols ✓ (rank_agents_for_offer, offers_status_valid, OfferSummary, smoke.mjs:274), brief↔plan ✓, Progress↔Faza ✓

## Findings

### F1 — Lokalnie smoke-agent nie trafi do top 3

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details („Smoke a lokalni agenci”), Faza 2 §5 kroki 1 i 6, Faza 3 §4
- **Detail**: Każdy przebieg smoke zakłada agenta z identycznym profilem (85 pkt). Remis rozstrzyga `created_at asc` (`create_offers.sql:97`), więc starsi smoke-agenci wygrywają. Lokalna baza ma już 7 takich agentów w Warszawie, więc nowy smoke-agent jest poza top 3. Zaproszenie dałoby `agent_not_ranked`, a kroki agenta z fazy 3 by padły. Odczyt id z ciasteczka mówi tylko, kim jest smoke-agent, ale nie daje mu miejsca w rankingu.
- **Fix**: Smoke-agent dostaje przedział cenowy unikalny dla przebiegu i staż 60 lat, a oferta rankingowa ma dokładnie tę cenę. Agent ma wtedy 100 pkt i 1. miejsce, a jego id smoke bierze z `agentId` pierwszego formularza „Zaproś”. Parsowanie ciasteczka odpada.
- **Decision**: FIXED
