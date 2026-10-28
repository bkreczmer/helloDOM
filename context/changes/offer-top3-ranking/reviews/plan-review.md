<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Oferta i ranking top 3

- **Plan**: context/changes/offer-top3-ranking/plan.md
- **Mode**: Deep (weryfikacja inline)
- **Date**: 2026-10-28
- **Verdict**: SOUND
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
9/9 paths ✓, 5/5 symbols ✓ (MAX_PRICE, isCity, profile_complete, db:types, pętla testów SQL w CI), brief↔plan ✓, Progress↔Fazy ✓

## Findings

### F1 — Test remisu po created_at przechodzi z niewłaściwego powodu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 1 — Test SQL
- **Detail**: Test działa w jednej transakcji, a `now()` zwraca czas jej startu, więc wszystkie profile w teście mają identyczne `created_at`. Remis rozstrzyga wtedy `id asc` i test przejdzie nawet bez sortowania po `created_at`.
- **Fix**: W teście ustaw jawnie `created_at` w kolejności odwrotnej do `id`, żeby `created_at asc` i `id asc` dawały różne wyniki.
- **Decision**: FIXED (Fix in plan)

### F2 — Smoke nie widzi rankingu, a anonimowość sprawdzamy tylko ręcznie

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 3 — Smoke (pkt 4), kroki 3.5 i 3.8
- **Detail**: `session()` w `scripts/smoke.mjs` zwraca tylko status i location; smoke fazy 3 sprawdza same kody HTTP, a nie wyrenderowany ranking ani brak e-maila agenta w HTML. Agent smoke ma pełny profil (warszawa, apartment, 100–900 tys., 5 lat), więc oferta smoke w Warszawie na 500 tys. zawsze go dopasuje.
- **Fix**: Rozszerz `session()` o body; po zapisaniu profilu agenta smoke właściciel dodaje ofertę (warszawa/apartment/500000), a strona oferty ma zawierać „Agent 1” i „/100” i nie zawierać `agentEmail`.
  - Strength: Krok 3.8 staje się automatyczny w CI; asercje odporne na lokalne konta dev.
  - Tradeoff: Przestawienie kolejności kroków smoke; bez sprawdzania dokładnego wyniku.
  - Confidence: HIGH — `session()` i dane agenta smoke już są w skrypcie.
  - Blind spot: Inne miejsca HTML, gdzie mógłby wyciec e-mail, niezweryfikowane.
- **Decision**: FIXED (Fix in plan)

### F3 — Komponenty UI nierozstrzygnięte: ChoiceCards, Badge, Select/Textarea

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 2 pkt 4, Faza 3 pkt 1
- **Detail**: „ChoiceCards.tsx (lub uogólnienie istniejącego wzorca)” zostawia wybór implementatorowi (uogólnienie RoleChoice dotknęłoby SignUpForm). W `src/components/ui/` są tylko `Card.astro` i `button.tsx`; brak Badge, Select, Textarea.
- **Fix**: Nowy `src/components/owner/ChoiceCards.tsx` (RoleChoice bez zmian); Badge przez `npx shadcn@latest add badge`; select i textarea natywne z klasami jak w FormField.
- **Decision**: FIXED (Fix in plan)

### F4 — Zgodność 18 slugów miast sprawdzana na oko (krok 1.6)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 1 — Manual 1.6
- **Detail**: Czwarta kopia listy miast; ręczne porównanie 18 slugów jest zawodne, a smoke ma już `ALL_CITIES`.
- **Fix**: W smoke fazy 2 pętla po `ALL_CITIES` (oferta w każdym mieście → 302 na `/owner/offers/<uuid>`); 1.6 przenieść do Automated.
- **Decision**: FIXED (Fix in plan)

### F5 — `db reset` w kryterium 1.1 niepotrzebnie kasuje lokalne konta

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 1 — Automated 1.1
- **Detail**: Czystą bazę i tak sprawdza CI (`supabase start` stosuje wszystkie migracje).
- **Fix**: Lokalnie `npx supabase migration up`; „czysta baza” = zielony job smoke w CI.
- **Decision**: FIXED (Fix in plan)
