<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Rejestracja z rolą właściciel/agent

- **Plan**: context/changes/role-based-signup/plan.md
- **Mode**: Deep
- **Date**: 2026-10-27
- **Verdict**: REVISE
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
Grounding: 14/14 paths ✓, 7/7 symbols ✓, brief↔plan ✓, Progress↔Phase ✓

## Findings

### F1 — no_profile signs out on any DB error and leaves no way forward

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 (Middleware), Phase 2 §1 (no_profile text)
- **Detail**: The middleware handles "no profile OR query error" the same way: `signOut()` → `?error=no_profile`. (a) A temporary error in the `profiles` query signs the user out and claims their account has no role. (b) The no_profile text says "Zarejestruj się ponownie", but the email is still in `auth.users`, so registering again ends with `user_already_exists`. The user hits a dead end.
- **Fix**: Split the branches. A query error leads to `/auth/signin?error=unavailable` without `signOut`. No profile (`data === null`) leads to `signOut` + `no_profile`. Change the no_profile text to drop "Zarejestruj się ponownie" (e.g. "Twoje konto nie ma przypisanej roli. Skontaktuj się z nami.").
  - Strength: The message matches the real cause, and a temporary error does not clear the session.
  - Tradeoff: One more branch in the middleware and in the manual check.
  - Confidence: HIGH — the dead end follows from "no backfill" and `user_already_exists`.
  - Blind spot: There is no contact channel yet.
- **Decision**: FIXED (Fix in plan)

### F2 — formData() exception: "unknown" in the contract vs invalid_input in check 2.7

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §3 vs Manual Verification 2.7
- **Detail**: The contract maps an exception inside try/catch to `?error=unknown`. For a JSON body, `formData()` throws TypeError (Fetch spec; Astro's checkOrigin does not check JSON, `origin-check.js:42-45`), so the result is `unknown`, while step 2.7 expects `invalid_input`.
- **Fix**: In §3, state that a failed `formData()` maps to `invalid_input` (like a failed parse); only exceptions from Supabase map to `unknown`.
- **Decision**: FIXED (Fix in plan)

### F3 — Generated database.types.ts gets reformatted by eslint --fix, so check 1.2 fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §3, Automated 1.2
- **Detail**: lint-staged runs `eslint --fix` on `*.ts`. eslint-plugin-prettier (printWidth 120), `consistent-type-definitions` and `array-type` rewrite the generated file at commit time. ESLint ignores come only from `.gitignore`, and there is no `.prettierignore`. As a result, `npm run db:types && git diff --exit-code` shows a diff. The plan's "if lint rejects it" condition never triggers, because the file is silently rewritten rather than rejected. Before the first commit, an untracked file passes `git diff` trivially.
- **Fix**: Unconditionally add `src/db/database.types.ts` to the ESLint ignores and to `.prettierignore` in Phase 1, and list both config files in "File:".
- **Decision**: FIXED (Fix in plan)

### F4 — dashboard.astro: Astro.locals.profile.role fails strict astro check

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §3
- **Detail**: `profile: Profile | null` together with `astro/tsconfigs/strict` means `profile.role` is a type error, even though the middleware guarantees a profile exists.
- **Fix**: Add a guard to the contract: `if (!profile) throw new Error(...)` (in the same style as AppLayout), then the redirect.
- **Decision**: FIXED (Fix in plan)

### F5 — /dashboard links outside the plan (one extra hop)

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §4
- **Detail**: The logo links in `AppTopbar.astro:20`, `Sidebar.astro:14`, `MobileNav.tsx:99` and the link in `src/pages/index.astro:18` point to `/dashboard`. They work, but each click costs an extra 302 plus a `profiles` query. The plan does not say what happens to these hrefs.
- **Fix**: In §4, state that the brand links in the shell use `homeFor(role)`, and that `index.astro` keeps `/dashboard`.
- **Decision**: FIXED (Fix in plan)
