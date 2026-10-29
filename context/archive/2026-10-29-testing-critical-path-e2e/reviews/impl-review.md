<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Test E2E ścieżki krytycznej (rollout Phase 2)

- **Plan**: context/changes/testing-critical-path-e2e/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Success criteria re-run on `main` (5a9a29a): `npm run lint` ok, `npx astro check` 0 errors, `npm run test:integration` 24/24, `npm run test:e2e` 4 passed on a cold server, 0 leftover `e2e-%-%` accounts. CI on PR #20: ci + smoke green (E2E 4 passed); a deliberate red run (actions run 40893936985) uploaded `playwright-report`.

## Findings

### F1 — retries and trace differ from the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: playwright.config.ts:18, playwright.config.ts:23
- **Detail**: Plan (plan.md:103) asks for `retries: 0` also in CI and `trace: "retain-on-failure"`. The config kept the setup template's `retries: process.env.CI ? 2 : 0` and `trace: "on-first-retry"`: in CI a flaky test turns green on a retry (and a serial retry re-runs `beforeAll`, 10 more sign-ups), and locally no trace is ever recorded. Not in the Addendum.
- **Fix**: Set `retries: 0` and `trace: "retain-on-failure"` as planned.
- **Decision**: FIXED — `retries: 0`, `trace: "retain-on-failure"` (as planned)

### F2 — local-only guard checks the wrong env file

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/helpers.ts:83
- **Detail**: `signUp` calls `supabaseEnv()`, which checks `SUPABASE_URL` from `.env` (Node). Accounts are created by the app server, which reads Supabase from `.dev.vars` (Cloudflare adapter), and the base URL could be any server reused on the port. With `.env` local and `.dev.vars` pointing at production, sign-ups would hit production (and its ~2 mails/h SMTP limit).
- **Fix**: Before the sign-up, refuse a non-local `baseURL` host and a non-local `SUPABASE_URL` in `.dev.vars` (when the file exists).
- **Decision**: FIXED — `assertLocalApp(baseURL)` in `signUp`: refuses a non-local base URL and a non-local `SUPABASE_URL` in `.dev.vars`

### F3 — an account that needs e-mail confirmation escapes the cleanup

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/helpers.ts:87
- **Detail**: The account is registered for cleanup only when the sign-up redirects to `/dashboard`. With confirmations on, `src/pages/api/auth/signup.ts:45` redirects to `/auth/confirm-email`: the account exists, the assertion fails and nothing deletes it (it has no session, so `POST /api/account/delete` could not delete it either).
- **Fix**: Register every 302 without `?error=` and report an account without a session as a leftover by e-mail in the cleanup error.
- **Decision**: FIXED — every 302 without `?error=` goes to the cleanup registry; an account without a session shows up by e-mail in the cleanup error

### F4 — context.close() outside the try in deleteAccounts

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/helpers.ts:148
- **Detail**: A throw from `context.close()` would stop the cleanup of the remaining accounts.
- **Fix**: Move `close()` into `finally`.
- **Decision**: FIXED — `context.close()` moved to `finally`

### F5 — supabaseEnv message still says "Testy integracyjne"

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/integration/helpers.ts:47-49
- **Detail**: The guard is now shared with E2E, so the message "Testy integracyjne działają tylko na lokalnym Supabase" misleads an E2E run.
- **Fix**: Change to "Testy działają tylko na lokalnym Supabase".
- **Decision**: FIXED — message now "Testy działają tylko na lokalnym Supabase"

### F6 — step 9 asserts "Oferta jest w obsłudze" text instead of the "W obsłudze" pill

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: tests/e2e/critical-path.spec.ts:252-254
- **Detail**: The plan names the pills "Przyjęte" and "W obsłudze". "Przyjęte" is asserted on `/agent`; for "W obsłudze" the spec checks the card text "Oferta jest w obsłudze" plus `in_progress` in the database, which protects the same state.
- **Fix**: None needed; accept as equivalent.
- **Decision**: ACCEPTED — the card text and `in_progress` in the database protect the same state as the pill
