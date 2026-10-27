<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Powłoka aplikacji w design systemie helloDOM

- **Plan**: context/changes/app-shell/plan.md
- **Mode**: Deep
- **Date**: 2026-10-27
- **Verdict**: REVISE → SOUND (po poprawkach)
- **Findings**: 0 critical · 3 warnings · 2 observations (+2 zmiany zgłoszone przez autora)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS |
| Plan Completeness | WARNING → PASS |

## Grounding
13/13 paths ✓, 6/6 symbols ✓ (.dark {, @custom-variant, bg-cosmic, signout→"/", missingConfigs, lucide-react), brief↔plan ✓, Progress↔Faza ✓

## Findings

### F1 — Nieczytelne statusy w dark (baner, ServerError, błędy pól)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 1 §1, §5; Faza 2 §3
- **Detail**: Nadpisania dark ze specyfikacji zmieniały bazę i `-soft` statusów, ale nie `-fg`; danger-fg na danger-soft ≈2:1, warn ≈1.6:1.
- **Fix**: Rozjaśnione `-fg` w dark (≥4.5:1 na `-soft`), dopisane do design-system.md.
- **Decision**: FIXED — `--rs-success-fg: oklch(0.85 0.12 145)`, `--rs-warn-fg: oklch(0.86 0.11 75)`, `--rs-danger-fg: oklch(0.82 0.10 28)`; plan + design-system.md; kryterium 1.9 z pomiarem kontrastu.

### F2 — Focus ring przycisków i linków prawie niewidoczny w light

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Faza 1 §1, Faza 2 §1, Faza 4
- **Detail**: `--shadow-focus` używał `--rs-accent-soft` (14% różowego accent-2 w bieli) — niewidoczny na białym tle.
- **Fix**: Focus na `--rs-accent-ring` / `--rs-accent`.
- **Decision**: FIXED — `--shadow-focus: 0 0 0 3px var(--rs-accent-ring)`; `:focus-visible` dla linków/przycisków `outline 2px --rs-accent` z offsetem 2px; plan + design-system.md; kryterium 1.10.

### F3 — Breakpointy 640/980 nie są zdefiniowane w Tailwindzie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 1 §1; Fazy 3–4
- **Detail**: Domyślne `sm` (≥640) i `lg` (1024) nie odpowiadają ≤640 / >980 ze specyfikacji.
- **Fix**: `--breakpoint-tablet: 641px`, `--breakpoint-desktop: 981px` w `@theme`.
- **Decision**: FIXED — dodane w Fazie 1, Faza 4 (Sidebar, MobileNav, Dock, AppLayout) używa `tablet:`/`desktop:`; design-system.md.

### F4 — Nierozstrzygnięte ikony w MobileNav

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 4 §1, §4
- **Detail**: „Ikony mapowane po href wewnątrz albo pomijane” zostawiało decyzję implementatorowi.
- **Fix**: Jedna konfiguracja nawigacji importowana przez wszystkich konsumentów.
- **Decision**: FIXED — `navConfig` (etykieta, ścieżka, ikona) w `nav.ts`; Sidebar, MobileNav i Dock importują ją bezpośrednio; MobileNav ma tylko prop `pathname`.

### F5 — Google Fonts z CDN a RODO

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 1 §2; What We're NOT Doing
- **Detail**: Ładowanie z fonts.googleapis.com przekazuje IP użytkowników z UE (LG München 2022).
- **Fix**: Self-hosting przez `@fontsource`.
- **Decision**: FIXED — `@fontsource/manrope` + `@fontsource/nunito` importowane w `global.css`; usunięte preconnect/linki Google; kryterium 1.6 (grep) i sprawdzenie Network w 1.8; design-system.md.

### A1 — Wariant `destructive` w Button (zgłoszone przez autora)

- **Decision**: FIXED — `destructive` zostaje na `--rs-danger` (S-04 „Usuń ofertę”, S-07 „Usuń konto”); usuwane tylko `outline`, `secondary`.

### A2 — Polskie błędy Supabase (zgłoszone przez autora)

- **Decision**: FIXED — Faza 2 §5: `toPolishAuthError()` w `src/lib/services/auth-errors.ts`, mapa po `error.code` (`invalid_credentials`, `user_already_exists`, `email_not_confirmed`, `weak_password`) + ogólny komunikat; kryterium 2.6 (grep), 3.8.
