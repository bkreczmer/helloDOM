<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Nagłówki no-store na odpowiedziach ustawiających ciasteczka sesji

- **Plan**: `context/changes/auth-cache-headers/plan.md`
- **Scope**: Full plan (CI review on PR #30)
- **Date**: 2026-10-29
- **CI run**: https://github.com/bkreczmer/helloDOM/actions/runs/40932852730
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Test Coverage       | PASS    |
| Success Criteria    | PASS    |

## Plan adherence

| Planned change                                                 | Verdict | Notes                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/supabase.ts`: keep the `setAll` headers, expose apply | MATCH   | `WeakMap<AstroCookies, Record<string, string>>` keyed by the request's cookie jar; headers are merged, not overwritten (as the plan's Key Discoveries require); `applyAuthCacheHeaders(cookies, response)` is exported. |
| `src/middleware.ts`: every response goes through the helper    | MATCH   | The old body becomes `guard()`; `onRequest` wraps it, so early redirects and `next()` both get the headers. The gate logic itself is unchanged.                                                                         |
| `scripts/smoke.mjs`: signup, signin, signout expect `no-store` | MATCH   | `noStore: true` on all three steps, checked against `cache-control`, with a diagnostic line on failure.                                                                                                                 |

No unplanned files: the diff is the three planned files plus `change.md` and `plan.md`. `createClient` keeps its signature, as the plan's exclusions require.

## Automated checks (run in this review job)

| Command             | Result                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run lint`      | PASS (exit 0)                                                                                            |
| `npx astro check`   | PASS: 91 files, 0 errors, 0 warnings, 0 hints                                                            |
| `npm run build`     | PASS (exit 0)                                                                                            |
| `npm run test:unit` | PASS: 2 files, 24 tests                                                                                  |
| `npm run smoke`     | NOT RUN: this job has no local Supabase and no `.env`. The CI `smoke` job runs it on this PR.            |
| Deliberate breakage | NOT RUN: the author reports it reddened smoke on signup, signin and signout. This job can't verify that. |

Manual verification (production `Cache-Control` on `POST /api/auth/signin` vs anonymous `GET /`) is unchecked, which means it is still pending, not failed.

## Findings

### F1 — Helper throws on responses with immutable headers

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; the fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/supabase.ts:36
- **Detail**: `response.headers.set(...)` throws `TypeError` when the headers are immutable, for example on `Response.redirect()` or a response passed through from `fetch()`. This only happens when auth cookies were written during that request. No current route hits it: every endpoint uses `context.redirect()` or `new Response(...)`, and both have mutable headers. A future route that returns `Response.redirect()` after a session write would turn a working redirect into a 500.
- **Fix**: If a route like that is ever added, catch the `TypeError` in `applyAuthCacheHeaders` and return `new Response(response.body, response)` with the headers set. Until then, leave it as is.
- **Decision**: PENDING

### F2 — "No headers without a cookie write" has no automated check

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; the fix is obvious and narrowly scoped
- **Dimension**: Test Coverage
- **Location**: scripts/smoke.mjs
- **Detail**: Desired End State says responses without a session-cookie write keep their current headers. Only the unchecked Manual Verification item covers this (anonymous `GET /` on production). Smoke asserts that `no-store` is present but never that it is absent. The plan only committed to the positive check, so this is not a gap against the plan.
- **Fix**: Optionally add a smoke step for anonymous `GET /` that expects no `no-store` in `Cache-Control`.
- **Decision**: PENDING

<!-- End of report -->
