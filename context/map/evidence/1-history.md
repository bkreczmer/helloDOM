# Evidence: history

Window: whole history, 2026-10-27 12:00 [858c0bb] .. 2026-10-29 16:33 [899b986] (3 days). Buckets: day (10-27 / 10-28 / 10-29). Commits counted: 91 of 92 non-merge (1 mass commit excluded: 858c0bb "chore: bootstrap 10x-astro-starter", 61 files). Noise excluded: `package-lock.json`, `src/db/database.types.ts`, `public/favicon.svg`. 1 human author (bkreczmer); 66/91 counted commits carry `Co-Authored-By: Claude` (counted as the human). Total changes (file touches): 503. Raw data: `context/map/.work/history-raw.txt`.

Context for every number below (evidence from commit subjects): each capability was built as a planned change (`feat(<change-id>): ... (pN)` phases, then `impl-review` fixes, then `chore(archive)`). Activity therefore reflects **build order**, not instability.

## Activity per capability

| Capability       | Changes | Share | Commits | Agent co-authored commits | Code-only changes / commits (no `context/`, no `*.md`) |
| ---------------- | ------- | ----- | ------- | ------------------------- | ------------------------------------------------------ |
| platform         | 99      | 19.7% | 41      | 34                        | 59 / 32                                                |
| invitations      | 63      | 12.5% | 21      | 16                        | 28 / 14                                                |
| auth             | 61      | 12.1% | 17      | 12                        | 38 / 12                                                |
| docs             | 60      | 11.9% | 46      | 26                        | —                                                      |
| offers           | 49      | 9.7%  | 15      | 12                        | 28 / 11                                                |
| app-shell        | 44      | 8.7%  | 13      | 10                        | 27 / 9                                                 |
| account-deletion | 30      | 6.0%  | 7       | 5                         | 11 / 3                                                 |
| shared           | 30      | 6.0%  | 17      | 15                        | 30 / 17                                                |
| agent-profile    | 30      | 6.0%  | 8       | 7                         | 11 / 4                                                 |
| ranking          | 28      | 5.6%  | 11      | 10                        | 7 / 7                                                  |
| access           | 9       | 1.8%  | 6       | 6                         | 9 / 6                                                  |
| unmapped         | 0       | 0%    | —       | —                         | —                                                      |

evidence: unmapped 0%; agent-co-authored share 66/91 = 73% of commits. Catch-alls (platform + shared + docs) = 37.6% of changes in this count.
evidence: about half of every product capability's changes are its planning folder (e.g. ranking 28 changes, only 7 in code). Planning churn is discussion, not code activity (rule 8).
inference: ranking is under-counted. Its SQL (`rank_agents_for_offer`) lives inside the offers and invitations migrations (contract note), so those touches count for offers/invitations.

## Top files in top capabilities

| Capability  | Top files (changes)                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| platform    | `scripts/smoke.mjs` (17), `.github/workflows/ci.yml` (7), `package.json` (6), testing-* plan/change files (5–6 each)                                                                       |
| invitations | `src/pages/owner/offers/[id].astro` (5), `src/pages/agent/index.astro` (4), `src/lib/services/invitations.ts` (3), plans for agent-invitation / invitation-response (5 each)               |
| auth        | `src/lib/services/auth-errors.ts` (5), `src/pages/api/auth/signup.ts` (5), `src/components/auth/SubmitButton.tsx` (4), `src/components/auth/FormField.tsx` (4), role-based-signup plan (8) |
| offers      | `src/pages/owner/index.astro` (5), `src/lib/services/offers.ts` (5), `src/components/owner/OfferForm.tsx` (3), owner-offer-management plan (7)                                             |
| app-shell   | `src/components/shell/nav.ts` (5), `src/components/shell/AppTopbar.astro` (4), `Dock.astro` (3), `MobileNav.tsx` (3)                                                                       |
| shared      | `src/types.ts` (8), `src/lib/dictionaries.ts` (5), `src/styles/global.css` (4)                                                                                                             |
| ranking     | `src/components/owner/RankingList.astro` (4), `supabase/tests/offer-ranking.sql` (2), `tests/integration/ranking.test.ts` (1)                                                              |
| docs        | `context/foundation/roadmap.md` (27), `context/foundation/test-plan.md` (8), `CLAUDE.md` (7), `README.md` (5)                                                                              |

## Trend

Commits per day (10-27 / 10-28 / 10-29):

| Capability       | 10-27 | 10-28 | 10-29 | Label                  | Campaign (from subjects)                                                                      |
| ---------------- | ----- | ----- | ----- | ---------------------- | --------------------------------------------------------------------------------------------- |
| platform         | 6     | 16    | 19    | rising                 | CI/smoke/deploy, then testing-* changes (ranking + isolation, critical-path E2E), agent hooks |
| docs             | 11    | 21    | 14    | constant               | roadmap updates per slice, test plan, audit                                                   |
| invitations      | 0     | 17    | 4     | seasonal (10-28 spike) | agent-invitation + invitation-response slices                                                 |
| auth             | 11    | 6     | 0     | fading                 | role-based-signup slice, then e-mail-callback/rate-limit fixes                                |
| offers           | 0     | 7     | 8     | rising                 | owner-offer-management (10-29) after offer-top3-ranking p2 (10-28)                            |
| app-shell        | 8     | 4     | 1     | fading                 | app-shell slice (10-27)                                                                       |
| shared           | 6     | 9     | 2     | seasonal               | types/dictionaries ride along with each feature slice                                         |
| agent-profile    | 0     | 8     | 0     | seasonal (one day)     | agent-profile slice                                                                           |
| ranking          | 0     | 8     | 3     | seasonal               | offer-top3-ranking slice (10-28); 10-29 = test + TEMP break/revert                            |
| account-deletion | 0     | 4     | 3     | seasonal               | account-deletion slice                                                                        |
| access           | 1     | 1     | 3     | rising (tiny n)        | 10-29 = isolation/E2E tests, not gate code changes                                            |

inference: every product capability shows a one-slice spike then quiet. That is the sequential slice plan, not shifting attention.

## Fix pressure

Heuristic: subject matches `fix|bug|hotfix|revert|regression|broken|incident` (case-insensitive); counted for every capability the commit touches; "cross" = commit touching > 3 capabilities.

| Capability       | Fix commits | Fix share | Reverts | Cross-cutting among fixes |
| ---------------- | ----------- | --------- | ------- | ------------------------- |
| docs             | 8           | 17%       | 0       | 2                         |
| auth             | 6           | 35%       | 0       | 1                         |
| platform         | 4           | 10%       | 0       | 0                         |
| shared           | 4           | 24%       | 0       | 2                         |
| ranking          | 3           | 27%       | 2       | 0                         |
| app-shell        | 2           | 15%       | 0       | 2                         |
| invitations      | 2           | 10%       | 0       | 0                         |
| account-deletion | 1           | 14%       | 0       | 1                         |
| agent-profile    | 1           | 13%       | 0       | 0                         |
| offers           | 1           | 7%        | 0       | 0                         |
| access           | 0           | 0%        | 0       | 0                         |

Reading the subjects (rules 5 and 12):

- evidence: most "fix" commits are the planned `impl-review fixes (F1…)` step of every slice (3f7cd5c, 9253e03, bb2260d, 96140a3, 95f1b42, 73ec850, b24b11c, e57d316), plus one `plan review fixes` (88c71c7). They are workflow, not defects found in use.
- evidence: the 2 ranking "reverts" are a deliberate CI break and its revert (0a5eea6 "TEMP deliberate break #1 for CI artifact" / d428be1), both a 1-line touch of `RankingList.astro`. That is mechanical (testing the pipeline), not instability.
- evidence: the only post-build corrective fixes are in **auth**: d4717df (the e-mail confirmation link returns to `/auth/callback`; adds `src/pages/auth/callback.ts`, touches `signup.ts`, `auth-errors.ts`, `supabase/config.toml`, smoke) and e584f83 (rate-limit message in `auth-errors.ts`), plus platform 27d42fd (`.gitignore` PLAN.md case-insensitivity).
- inference: auth carries the only real fix pressure (2 production-behaviour fixes around e-mail confirmation and rate limits). Every other capability's fix share comes from the review step.

## Co-change between capabilities

Co-change uses the counted commits; 2 commits touching > 5 capabilities dropped (9e4775b role-based-signup p3, 8 caps; 317dcad offer-top3-ranking p3, 6 caps). Confidence = shared ÷ commits of the less active side.

All paths (top):

| Pair                          | Support | Confidence |
| ----------------------------- | ------- | ---------- |
| docs–platform                 | 16      | 0.39       |
| auth–docs                     | 10      | 0.59       |
| docs–invitations              | 9       | 0.43       |
| invitations–platform          | 8       | 0.38       |
| docs–shared                   | 8       | 0.47       |
| platform–shared               | 7       | 0.41       |
| auth–platform                 | 7       | 0.41       |
| app-shell–shared              | 6       | 0.46       |
| offers–ranking                | 4       | 0.36       |
| access–platform / access–docs | 4       | 0.67       |

Code only (no `context/`, no `*.md`):

| Pair                   | Support | Confidence |
| ---------------------- | ------- | ---------- |
| invitations–platform   | 8       | 0.57       |
| platform–shared        | 7       | 0.41       |
| auth–platform          | 6       | 0.50       |
| app-shell–shared       | 5       | 0.56       |
| offers–platform        | 5       | 0.45       |
| auth–shared            | 5       | 0.42       |
| invitations–offers     | 4       | 0.36       |
| offers–ranking         | 3       | 0.43       |
| agent-profile–platform | 3       | 0.75       |

inference: X–platform pairs are driven by `scripts/smoke.mjs` (each slice extends the smoke test) and `package.json`. X–docs pairs are driven by `roadmap.md` updates per slice (rule 4: shared cause, the slice workflow). The product-level couplings that remain are invitations–offers (offer status lifecycle) and offers–ranking (ranking runs on the saved offer; `OfferForm.tsx`, `offers.ts`, `owner/index.astro` touched by the ranking slice and its review fixes).

## Hub files and freshness

Distinct partner capabilities seen in ≥ 2 commits (co-change rule applied):

| File                                                                                                                                          | Partners ≥2 | What it is                                                       | Signal                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `context/foundation/roadmap.md`                                                                                                               | 9           | roadmap, updated per slice                                       | mechanical (rules 4, 8)                             |
| `scripts/smoke.mjs`                                                                                                                           | 7           | smoke test, extended per slice                                   | mechanical (rule 3: CI runs it, drift fails loudly) |
| `src/types.ts`                                                                                                                                | 6           | shared DTOs/types                                                | lockstep guarded by `astro check` (rule 3)          |
| `src/lib/dictionaries.ts`                                                                                                                     | 5           | shared enums/labels (cities, property types, statuses)           | inference: real shared vocabulary; guarded by types |
| `src/lib/services/offers.ts`                                                                                                                  | 4           | offers service also used by ranking/invitations                  | inference: genuine cross-capability seam            |
| `src/components/auth/SubmitButton.tsx`                                                                                                        | 4           | form button reused outside auth                                  | inference: misplaced shared component               |
| `src/styles/global.css`                                                                                                                       | 3           | design tokens                                                    | shared by design                                    |
| `src/pages/owner/offers/[id].astro`, `src/lib/services/invitations.ts`, `OfferForm.tsx`, `OfferSummary.astro`, `src/pages/api/auth/signup.ts` | 3           | offer detail page (offer + ranking + invitation), services, form | inference: the offer→ranking→invitation corridor    |

Freshness: `git cat-file -e HEAD:<path>` returned OK for every file named in this document. Deleted/moved history (from the contract, rule 11): `src/components/Topbar.astro`, `src/components/Welcome.astro` (deleted, starter), `src/pages/dashboard.astro` → `src/pages/dashboard.ts`, `src/components/owner/OfferSummary.astro` → `src/components/offers/OfferSummary.astro`; folded into current capabilities.

## Mechanical signals

- platform as the most active capability: a test/CI campaign on 10-28 and 10-29 (testing-* changes, hooks). Rules 4 and 5.
- docs activity and the docs pairs: roadmap/plan churn per slice. Rule 8; not a hot area.
- Fix share across all capabilities except auth: the planned impl-review step. Rule 5.
- Ranking reverts: a deliberate CI break and its revert. Rule 12-like spillover; not a defect.
- `smoke.mjs`, `roadmap.md`, `types.ts` hubs: workflow lockstep. Rules 3 and 4.
- Concentration: 1 human. Rule 6 baseline; agent co-authorship is activity, not a second person (rule 7).

## Unknowns

- unknown: ranking's real churn. The RPC SQL sits in offers/invitations migration files, so path attribution cannot separate it.
- unknown: pairs that should co-change but cannot be seen: the `rank_agents_for_offer` SQL scoring vs `tests/integration/ranking.test.ts` / `supabase/tests/offer-ranking.sql`; the RLS policies in migrations vs `tests/integration/isolation.test.ts`; `src/lib/dictionaries.ts` enums vs DB check constraints/enums in migrations; `src/types.ts` vs `src/db/database.types.ts` (generated, excluded; CI checks `db:types` per the user's notes, not verified here).
- unknown: whether production issues happened without a `fix` subject (3 days, no issue tracker usage visible in the log).
- Statistical caveat: 91 commits over 3 days; every trend label rests on single-digit counts.

## Commands run

- `cat` of the brief, scan contract, capabilities.tsv, attr.py, false-signals.md, head of git-log.txt
- `python3 hist.py` (scratchpad): parse `.work/git-log.txt`, attribute via `attr.cap`, count changes/commits/day buckets/fix/revert/pairs/hubs → `.work/history-raw.txt`
- `python3 -` code-only variant (exclude `context/`, `*.md`) → appended to `.work/history-raw.txt`
- `git -c core.quotepath=off show --stat` for d4717df, e584f83, 27d42fd, 0a5eea6, d428be1, bb2260d
- `git cat-file -e HEAD:<path>` for all named files
