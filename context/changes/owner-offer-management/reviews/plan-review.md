<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Owner offer management (S-04)

- **Plan**: context/changes/owner-offer-management/plan.md
- **Mode**: Deep (weryfikacja inline)
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
10/10 paths ✓, 6/6 symbols ✓, brief↔plan ✓, Progress↔Fazy ✓

## Findings

### F1 — Kroki smoke'a mają ruchome okno stanu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 2 §8 i Faza 3 §4 — Smoke
- **Detail**: Plan sprawdza edit_locked „po zaproszeniu na rankedOfferId”, ale ta oferta jest `invited` tylko między zaproszeniem (smoke.mjs:364-366) a odrzuceniem (smoke.mjs:408-411). Nowe kroki wymagają aktywnych sesji owner/otherOwner/agent, wylogowanych od smoke.mjs:502. Plan nie mówi, gdzie wstawić kroki.
- **Fix**: Kroki edit_locked na `acceptedOfferId` (`in_progress` od smoke.mjs:489 do 502), po „owner offer page shows the accepted invitation”; wszystkie kroki S-04 przed „second owner signout”.
- **Decision**: FIXED

### F2 — Usunięcie oferty z agentem bez testu z perspektywy agenta

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 3 §4 — Smoke; brief „Key risk” fazy 3
- **Detail**: Smoke usuwa tylko `managedOfferId` w `seeking_agent`; utratę dostępu agenta sprawdza wyłącznie krok ręczny 3.6, test SQL pokrywa samą kaskadę. `acceptedOfferId` jest potrzebny dalej (smoke.mjs:550).
- **Fix**: `managedOfferId` pasujący do smoke agenta; po edycji zaproszenie, edit_locked dla `invited`, usunięcie, agent `/agent/offers/<id>` → 404 i `/agent` bez linku.
  - Strength: Ryzyko z briefu dostaje automatyczny test od strony użytkownika; pokrywa też blokadę `invited`.
  - Tradeoff: Edycja musi zostawić ofertę w przedziale agenta.
  - Confidence: MED — nie sprawdzono przedziału cen smoke agenta ani limitu aktywnych zaproszeń agenta.
  - Blind spot: Smoke rośnie o ~4 kroki.
- **Decision**: FIXED

### F3 — Anonim bez offerId dostaje 404 zamiast /auth/signin

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 2 §6, Faza 3 §2
- **Detail**: Kontrakt sprawdza offerId (→ 404) przed sesją; wzorzec `api/owner/invitations.ts:14-27` zawsze sprawdza sesję, a zły offerId zmienia tylko cel błędu.
- **Fix**: Sesja i rola przed 404 za zły offerId.
- **Decision**: FIXED
