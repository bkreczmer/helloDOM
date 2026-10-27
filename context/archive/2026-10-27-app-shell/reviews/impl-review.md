<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Powłoka aplikacji w design systemie helloDOM

- **Plan**: context/changes/app-shell/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-27
- **Verdict**: NEEDS ATTENTION → APPROVED after triage (open items deferred to S-01)
- **Findings**: 0 critical · 6 warnings · 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria: 22/22 PASS (lint, astro check, build, 9 greps, smoke 8/8 on production preview with local Supabase). Manual: 19/19 ticked; two ticks (2.7 hover, 2.7 disabled-while-sending) lack an observable implementation — see F3, F5.

## Findings

### F1 — Text and CTA tokens fail WCAG AA contrast in light mode

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/styles/global.css:33-35; src/components/ui/button.tsx:14-15; src/pages/index.astro:10
- **Detail**: Measured on white: `--rs-fg-2` 3.88:1 (form labels, sidebar links, dashboard text), `--rs-fg-3` 2.24:1 (password hint, dock labels 9.5px, PasswordToggle icon), `--rs-fg-4` 1.60:1 (placeholders, `.microlabel`). White on `--rs-accent` #2B9AF5 is 2.98:1 — the `accent` button (all main CTAs) and the light end of the hero gradient. Values come straight from design-system.md, so the spec itself is the source.
- **Fix A ⭐ Recommended**: Adjust tokens in design-system.md + global.css — `fg-2` ≈ 85% mix, `fg-3` ≈ 65–70% (≥4.5:1), keep `fg-4` for placeholders/decoration only; `accent` button fill `--rs-accent-hover` (4.85:1); hero gradient starts darker.
  - Strength: Fixes every current and future usage at the token level; same approach as the approved dark `-fg` fix.
  - Tradeoff: Visible shift of the brand's lighter blues; spec edit.
  - Confidence: HIGH — contrast verified with an OKLab color-mix computation.
  - Blind spot: Exact percentages need a recheck in a contrast tool; dark mode `fg-3` (3.84:1) also borderline.
- **Fix B**: Keep tokens; move text uses of `fg-3`/`fg-4` to `fg-2`, darken only `fg-2`, use `primary` variant for CTAs
  - Strength: Smaller change to the brand palette.
  - Tradeoff: Many call-site edits; tokens remain easy to misuse in S-01…S-07.
  - Confidence: MED — depends on discipline in later slices.
  - Blind spot: Accent-on-white in dock active state stays at 2.98:1.
- **Decision**: FIXED (Fix A, adjusted) — `fg-2` 88%, `fg-3` 80%, `fg-4` decoration only (placeholder and `.microlabel` → `fg-3`); new `--rs-accent-strong` #1E75BC for the `accent` CTA fill (hover `accent-active`), hero gradient start and active nav icons in Sidebar/MobileNav/Dock (≥3:1 per WCAG 1.4.11 in both themes); dock active label `accent-fg`; `--rs-accent` reserved for decorative elements (confirm-email icon). Spec updated.

### F2 — `?error=` lets anyone inject text into the branded error box

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/auth/signin.astro:6,13; src/pages/auth/signup.astro:6,13
- **Detail**: The raw query param is rendered in `ServerError` (`role="alert"`). React escapes it (no XSS), but `/auth/signin?error=Konto zablokowane – zadzwoń pod …` shows attacker text as a genuine system message (phishing aid).
- **Fix**: Endpoints redirect with a code (`?error=invalid_credentials`); pages map it through an allowlist in `auth-errors.ts`, unknown codes → generic Polish message. Smoke checks only the `?error=` prefix.
- **Decision**: DEFERRED to S-01 (role-based-signup) — S-01 rewrites the auth endpoints anyway; error codes + allowlist added there with F6. Requirement recorded in context/foundation/roadmap.md (S-01, "Carried over").

### F3 — Submit button never shows its pending/disabled state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/components/auth/SubmitButton.tsx:12
- **Detail**: `useFormStatus()` only reports `pending` for React form actions; these forms post natively to `action="/api/auth/signin"`, so `pending` is always false — no spinner, no double-submit guard. Manual 2.7 ("disabled przycisku przy wysyłaniu") was ticked without this being reachable. Pre-existing bug, but restyled here.
- **Fix**: Track `submitting` with `useState` in SignInForm/SignUpForm (set after `validate()` passes) and pass it to `SubmitButton` as a prop.
- **Decision**: FIXED — `useNativeSubmitting` hook (src/components/hooks/) sets `submitting` after `validate()` passes and resets on bfcache `pageshow`; SignInForm/SignUpForm pass `pending` to SubmitButton (useFormStatus removed).

### F4 — Mobile drawer stays open above 640 px

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/shell/MobileNav.tsx:63,77-123
- **Detail**: Plan: drawer only ≤640 px (`tablet:hidden`). The portal renders into `document.body`, escaping the `tablet:hidden` wrapper; rotating/resizing past 640 px with the drawer open leaves it on screen with body scroll locked.
- **Fix**: In the open-state effect, add a `matchMedia("(min-width: 641px)")` listener that closes the drawer (or add `tablet:hidden` to the portal root).
- **Decision**: FIXED — `matchMedia("(min-width: 641px)")` change listener in the open-state effect closes the drawer (and releases the scroll lock) when the viewport leaves mobile.

### F5 — Form fields have no hover state

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/components/auth/FormField.tsx:6
- **Detail**: Manual 2.7 and the design-system DoD require hover; `inputBase` styles only focus and error. Tick 2.7 not backed by code.
- **Fix**: Add `hover:border-rs-line-strong` (or `hover:border-rs-fg-3`) to `inputBase`, not overriding focus/error.
- **Decision**: DEFERRED to S-01 (role-based-signup) — S-01 reworks the auth forms; hover state recorded in roadmap S-01 "Carried over". Note: the proposed `line-strong` (24%) would be lighter than `--rs-input-border` (28%); use a darker border such as `fg-3`.

### F6 — Changed auth endpoints skip `astro/zod` validation and parse-error handling

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signin.ts:6-8; src/pages/api/auth/signup.ts:6-8
- **Detail**: CLAUDE.md requires `z` from `astro/zod` for API input. Both routes (touched in p2) still use `form.get(...) as string`; a non-form body makes `formData()` throw → unhandled 500 instead of a `?error=` redirect; a thrown Supabase call is uncaught. Pre-existing, and the plan excluded auth-logic changes.
- **Fix A ⭐ Recommended**: Separate small follow-up change (e.g. `auth-input-validation`) together with F2's error codes
  - Strength: Respects this plan's "no auth logic changes" boundary; one focused diff for the endpoints.
  - Tradeoff: Leaves the gap open until that change lands.
  - Confidence: HIGH — the scope line is explicit in the plan.
  - Blind spot: S-01 may touch these endpoints first.
- **Fix B**: Fix now in this change (try/catch + `z.object({email, password}).safeParse`)
  - Strength: Closes the gap immediately; ~15 lines.
  - Tradeoff: Scope creep beyond the reviewed plan.
  - Confidence: HIGH — small, well-understood edit.
  - Blind spot: Smoke covers only happy/wrong-password paths.
- **Decision**: DEFERRED to S-01 (role-based-signup) together with F2, per user decision during F2 triage (Fix A spirit: outside this plan's scope). Requirement recorded in roadmap S-01.

### F7 — Small a11y and consistency gaps in nav and auth pages

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/shell/MobileNav.tsx:69,96; src/pages/auth/confirm-email.astro:27-30
- **Detail**: Hamburger `aria-controls` points to an element that exists only while open; drawer `<nav>` has no `aria-label` (Sidebar/Dock do); confirm-email puts `h1.page-title` inside the Card while signin/signup put it above.
- **Fix**: Drop `aria-controls` when closed (or keep drawer mounted+hidden), add `aria-label="Nawigacja"` to the drawer nav, move confirm-email `h1` above the Card.
- **Decision**: FIXED — `aria-controls` only while open; drawer `<nav aria-label="Główna nawigacja">` (dialog keeps "Nawigacja"); confirm-email `h1.page-title` moved above the Card like signin/signup.

### F8 — Form feedback, autocomplete and reduced motion

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/auth/SignInForm.tsx:36-40; SignUpForm.tsx:59-63; FormField.tsx; src/components/ui/button.tsx:8
- **Detail**: Failed client validation doesn't move focus (screen readers get nothing); no `autoComplete` (`email`, `current-password`, `new-password`); hint not in `aria-describedby`; no `prefers-reduced-motion` handling for button lift/transitions.
- **Fix**: Focus first `aria-invalid` field on failed submit; add `autoComplete` prop; include hint id in `aria-describedby`; add `motion-reduce:hover:translate-y-0 motion-reduce:transition-none` to Button base.
- **Decision**: FIXED — failed submit focuses the first `aria-invalid` field (rAF after render); `autoComplete` prop on FormField (`email`, `current-password`, `new-password`); hint wrapped with id and referenced by `aria-describedby`; Button base `motion-reduce:transition-none motion-reduce:hover:translate-y-0`.

### F9 — Unneeded font weight and React runtime on simple pages

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/styles/global.css:1; src/layouts/PublicLayout.astro:18; src/components/shell/AppTopbar.astro:18
- **Detail**: Manrope 300 imported but never used; `ThemeToggle client:load` is the only island on `/` and confirm-email, so those pages ship React for a stateless toggle; MobileNav hydrates on desktop too.
- **Fix**: Drop `manrope/300.css`; use `client:media="(max-width: 640px)"` for MobileNav; optionally rewrite ThemeToggle as `.astro` + `<script>`.
- **Decision**: FIXED (partial, per user) — removed `@fontsource/manrope/300.css` (unused); MobileNav hydrates with `client:media="(max-width: 640px)"`. Rewriting ThemeToggle as `.astro` SKIPPED.

### F10 — Defence-in-depth and minor consistency notes

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/layouts/AppLayout.astro:13; src/pages/auth/confirm-email.astro:6; src/pages/index.astro:18; src/layouts/Layout.astro:17-24
- **Detail**: AppLayout renders the shell for anonymous users if a future page is missing from `PROTECTED_ROUTES`; confirm-email picks its message from `import.meta.env.DEV` (pre-existing); buttons on `<a>` use two forms (`class:list={cn(...)}` vs `class:list={[...]}`); theme script doesn't set `color-scheme` itself (CSS does — no practical effect).
- **Fix**: Add a redirect guard (or comment) in AppLayout; unify on `class:list={[buttonVariants(...)]}`; leave the DEV logic for the auth follow-up.
- **Decision**: FIXED (partial, per user) — AppLayout throws when there is no user (Astro.redirect is not allowed in layouts; redirect stays in middleware), message points to PROTECTED_ROUTES. confirm-email DEV logic DEFERRED to S-01 (roadmap "Carried over"). class:list unification and color-scheme in theme script SKIPPED.
