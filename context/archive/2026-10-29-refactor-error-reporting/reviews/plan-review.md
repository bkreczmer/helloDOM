<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Wspólna obsługa i raportowanie błędów (refaktor M4)

- **Plan**: context/changes/refactor-error-reporting/plan.md
- **Mode**: Deep (inline verification — the riskiest claims were verified in code during research and planning: `AstroGlobal extends APIContext` with `routePattern`, auth error guards exported from `@supabase/supabase-js`, smoke's exact `302 /auth/signin` expectations)
- **Date**: 2026-10-29
- **Verdict**: SOUND (after F1)
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | PASS    |
| Plan Completeness     | WARNING |

## Grounding

9/9 paths ✓, 3/3 symbols ✓ (`isAuthRetryableFetchError`, `toAuthErrorCode`, `routePattern`), brief↔plan ✓, Progress 23↔23 ✓

## Findings

### F1 — Polecenie preview do smoke zostawi demona Astro 7

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Fazy 2–4, Success Criteria (smoke)
- **Detail**: `npx astro preview --port 4323` „w tle” bez `ASTRO_PREVIEW_BACKGROUND=1` przechodzi w Astro 7 w demona, gdy wykryje agenta. Port zostaje zajęty, a kolejna faza testuje stary build. W tym projekcie osierocony demon już wcześniej blokował 4322.
- **Fix**: Dopisać `ASTRO_PREVIEW_BACKGROUND=1` i krok zatrzymania z kontrolą wolnego portu.
- **Decision**: FIXED

### F2 — Middleware loguje dwa razy przy renderze strony 500

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 2, middleware
- **Detail**: Astro uruchamia middleware ponownie przy renderze 500 (`node_modules/astro/dist/core/errors/default-handler.js:80`), więc jedna awaria może dać dwie linie z tym samym `requestId`.
- **Fix**: Zdanie w Critical Implementation Details.
- **Decision**: FIXED

### F3 — `no_profile` na poziomie error może hałasować dla kont sprzed ról

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 2, middleware
- **Detail**: `context/archive/2026-10-27-role-based-signup/plan.md:513` przewiduje `no_profile` jako ścieżkę dla kont sprzed ról. Każde ich wejście da linię error. Na produkcji jest niewiele kont testowych, a poziom error jest właściwy dla regresji RLS.
- **Fix**: Bez zmian.
- **Decision**: ACCEPTED — error jest właściwy dla regresji RLS; kont sprzed ról praktycznie nie ma
