<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Wspólna obsługa i raportowanie błędów (refaktor M4)

- **Plan**: context/changes/refactor-error-reporting/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-29
- **Verdict**: NEEDS ATTENTION (before triage) → APPROVED after fixes
- **Findings**: 0 critical, 2 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Success criteria re-run after the fixes (branch `chore/refactor-error-reporting-review` on top of `9a90502`): lint clean, `astro check` 0 errors, `npm run test:unit` 24/24, `npm run test:integration` 64/64 (Vitest incl. unit + hooks), `npm run test:e2e` 4/4. Phases 1–4 verified locally per the plan (smoke on fresh preview builds, manual 2.5 / 3.6 / 4.7 in the addendum); CI on PR #25 green. Two reviewers (plan drift; safety and patterns) found no behaviour change beyond the planned D1, middleware outage and page 503s, and no personal data in any log path.

## Findings

### F1 — Stack line 1 logs the untruncated message

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/report-error.ts:68
- **Detail**: `stack.split("\n").slice(0, 5)` keeps line 1, which in V8 is `Name: message`, so the full message bypassed the 200-character cut. No current throw site puts user data in a message, but a future one would leak.
- **Fix**: Keep lines 2–6 of the stack only; test with a long message containing an e-mail.
- **Decision**: FIXED — `slice(1, MAX_STACK_LINES + 1)`; test `drops stack line 1`; deliberate break (back to `slice(0, …)`) turns it red

### F2 — Auth log-level rule duplicated in signin and signup

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signin.ts:31-35, src/pages/api/auth/signup.ts:40-45
- **Detail**: The same "which auth errors to log, at which level" rule was inlined twice and had no test.
- **Fix**: Extract a pure `authErrorLogLevel(code, status)` into `src/lib/services/auth-errors.ts` with a table test.
- **Decision**: FIXED — `authErrorLogLevel` + `tests/unit/auth-errors.test.ts` (6 rows)

### F3 — `extra` could overwrite context fields

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/report-error.ts:86
- **Detail**: `...extra` came after `requestContext`, so an `extra.userId` or `extra.route` would replace the real value.
- **Fix**: Spread `extra` first.
- **Decision**: FIXED — test `extra cannot overwrite the context fields`

### F4 — D1 and middleware classification have no automated test

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: src/pages/api/account/delete.ts:53-56, src/middleware.ts:19-34
- **Detail**: Both branches are covered by `isAuthOutage` unit tests, smoke (unchanged redirects) and the manual checks 2.5 / 3.6, but not by a test that would fail on a regression of the branch wiring itself.
- **Fix**: Extract `deleteOutcome(data)` and `authGate({ outage, gated, user })` as pure functions with unit tests.
  - Strength: cheap regression guard for the two behaviour changes.
  - Tradeoff: two more abstractions for ~5 lines of branching each.
  - Confidence: MED — the pattern exists (`isAuthOutage`), but the extraction changes two hot files again.
  - Blind spot: none significant.
- **Decision**: ACCEPTED — manual checks with a swapped RPC and a stopped Auth gateway are recorded in the plan addendum; revisit with the next change to these files

### F5 — Op suffixes and the profile 0-row level are not in the plan

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/api/**, src/pages/**/*.astro; src/pages/api/agent/profile.ts:61
- **Detail**: Implementation adds op suffixes (`.config`, `.role`, `.read`, `.not_found`, `.signOut`) and logs 0 updated rows of the agent profile as `error`; neither is written down, which matters for log queries.
- **Fix**: Document the suffix convention in `report-error.ts` and the plan addendum.
- **Decision**: FIXED

### F6 — Arbitrary object logging untested

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/report-error.ts:75
- **Detail**: The branch that logs only `typeof` for an unexpected object (e.g. a data row) had no test.
- **Fix**: Test with an object carrying an e-mail and a price.
- **Decision**: FIXED

### F7 — Duplicate `userId` in the no_profile log

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/middleware.ts:54
- **Detail**: `extra: { userId }` repeated what `requestContext` already adds.
- **Fix**: Drop the extra.
- **Decision**: FIXED
