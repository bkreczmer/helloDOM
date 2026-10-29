# Evidence: discussion

Sources: `gh` read-only on bkreczmer/helloDOM (23 PRs, 0 issues, 64 CI runs — all within limit 100, no limits hit) + git (merge commits → PR files → `attr.py`) + `context/archive/*` plans and reviews + `context/foundation/lessons.md` + `context/audits/observability/2026-10-29_*.md`. Window: whole history 2026-10-27 .. 2026-10-29 (HEAD 899b986). Raw data: `.work/gh-prs.json`, `.work/gh-issues.json`, `.work/gh-runs.json`, `.work/pr-caps.json`.

Baseline (evidence): 1 human author, 66/92 commits co-authored by Claude. Every review in this repo is **self-review through skills** (`/10x-plan-review`, `/10x-impl-review`); there is **no human review on GitHub** — 0 reviews on all 23 PRs, 1 PR comment in total (author on #7). Medians of review activity are therefore not reported.

## Buzz per capability

PRs = merged PRs whose commits touch the capability (one PR counts for every capability it touches; 11 of 22 merged PRs touch > 3 capabilities). Plans = change folders. Review F = findings in plan-review + impl-review. Audit = observability findings (critical/high/total) attributed by first `src/`/`supabase/` path in each finding. Markers = TODO/FIXME/HACK/XXX at HEAD.

| Capability       | PRs (merged)                     | Closed unmerged | Human review | Reverts        | Fix commits                 | Issues / open bugs | Plans                                                    | Review F (plan+impl)                         | Audit crit/high/total | Markers |
| ---------------- | -------------------------------- | --------------- | ------------ | -------------- | --------------------------- | ------------------ | -------------------------------------------------------- | -------------------------------------------- | --------------------- | ------- |
| auth             | 7 (#2,3,4,5,6,13,14)             | 0               | 0            | 0              | 3 (2 post-merge prod fixes) | 0 / 0              | 1                                                        | 13 (5+8)                                     | 0/3/5                 | 0       |
| access           | 4 (#2,3,19,20)                   | 0               | 0            | 0              | 0                           | 0 / 0              | 0 own (isolation tests in a platform `testing-*` change) | —                                            | 2/1/5                 | 0       |
| agent-profile    | 2 (#6,10)                        | 1 (#7)          | 0            | 0              | 1                           | 0 / 0              | 1 (+ follow-ups/)                                        | 10 (6+4)                                     | 0/0/1                 | 0       |
| offers           | 6 (#3,8,9,11,17,18)              | 0               | 0            | 0              | 0                           | 0 / 0              | 1                                                        | 6 (3+3)                                      | 0/1/4                 | 0       |
| ranking          | 5 (#8,9,11,19,20)                | 0               | 0            | 0              | 1                           | 0 / 0              | 1 (+ follow-ups/)                                        | 11 (5+6)                                     | 0/0/0 (see Unknowns)  | 0       |
| invitations      | 10 (#3,6,8,11,12,13,14,17,20,21) | 0               | 0            | 0              | 1                           | 0 / 0              | 2                                                        | 16 (1+4, 5+6)                                | 2/3/8                 | 0       |
| account-deletion | 2 (#15,16) (+#23 mechanical)     | 0               | 0            | 0              | 0                           | 0 / 0              | 1                                                        | 9 (3+6)                                      | 1/1/5                 | 0       |
| app-shell        | 6 (#2,3,6,8,15,16)               | 0               | 0            | 0              | 1                           | 0 / 0              | 1                                                        | 15 (5+10)                                    | —                     | 0       |
| platform         | 15                               | 0               | 0            | 1 (deliberate) | 1 (`.gitignore`)            | 0 / 0              | 2 + `changes/bootstrap-verification`                     | 17 (6 e2e + 3+5 ranking-isolation… see note) | —                     | 0       |
| shared           | 9                                | 0               | 0            | 0              | 0                           | 0 / 0              | 0                                                        | —                                            | —                     | 0       |
| docs             | 20                               | 0               | 0            | 0              | 0                           | 0 / 0              | —                                                        | —                                            | —                     | 0       |

Note: platform review F = testing-critical-path-e2e 3+6 + testing-ranking-and-isolation 3+5 = 17. Unassigned audit volume: A9 (no path, "all auth endpoints + middleware"), O8 (migration glob `20261028180000_*` not resolvable) = 2 of 27 findings.

## Friction

- **auth — the only genuine second attempt (evidence).** PR #3 (role-based-signup) merged, then two post-merge fix PRs within hours: #4 `fix/email-confirm-callback` (d4717df, confirmation link returns to `/auth/callback`) and #5 `fix/auth-rate-limit` (e584f83, 429 shown as generic error), then #3's impl-review fixes F1–F6 (3f7cd5c). Impl-review verdict: **NEEDS ATTENTION** (only slice besides app-shell not plainly APPROVED). A lesson was recorded for it: "Sprawdzaj flow potwierdzenia e-maila na produkcji, zanim zamkniesz slice". Inference: email confirmation / SMTP rate limit is the first place production behaviour diverged from local.
- **agent-profile — closed-unmerged PR #7** (`fix/agent-profile-review`); author comment: "Zastąpiony przez fix/agent-profile-followups (konflikt z zarchiwizowanym folderem)" → re-landed as #10. Evidence says the cause was a workflow conflict with the archived folder, not code → mechanical (see below).
- **app-shell — largest review finding count (impl-review 10 F)**, verdict "NEEDS ATTENTION → APPROVED after triage (open items deferred to S-01)"; lesson "Sprawdzaj kontrast tokenów kolorów przy ich definiowaniu" (WCAG F1). Fixed in 73ec850.
- **invitations — most discussed core capability**: 10 PRs, 2 change folders, 16 review findings, 8 audit findings incl. 2 critical (O1 `catch {}` in API endpoints → redirect without log; O2 page frontmatter errors). Review findings point at status lifecycle edges: agent deletion leaves offer stuck in `invited` (agent-invitation F1), re-invite after reject gives misleading `offer_locked` (F3), lock order trigger vs RPC (account-deletion F4), `for update` on someone else's offer before invitation check (invitation-response F3). Inference: the status state machine is where attention and edge cases concentrate.
- **access — audit hot spot without its own plan**: 2 critical audit findings (A1: Supabase Auth outage looks like "logged out"; A2: RLS regression on `profiles` silently signs users out). No change folder targets access; it is covered only by `tests/integration/isolation.test.ts` (platform change testing-ranking-and-isolation).
- **account-deletion — 1 critical audit finding** (D1: `not_found` treated as success → `/?deleted=1`); impl-review F1 "production steps 3.4–3.6 ticked without recorded results".
- **ranking**: impl-review F3 "RPC returns `agent_id` and allows enumerating agent profiles", F4 "Supabase/RPC errors swallowed, error state returns 200" (later confirmed by audit as the "Błąd RPC rankingu → 200" row). Follow-ups folder exists.
- **CI**: 2 failed runs of 64. 9e86c06 on `main` (first CI run on main, "docs: AGENTS.md…; ci: run on main" — ci + smoke red; bootstrap iteration) and 0a5eea6 on PR #20 (deliberate break, reverted in d428be1).

## Planning attention

Every feature capability went through the same chain (plan → plan-review → implement → impl-review → closeout PR), so plan count is ~1 per capability by construction. Differences are in review findings and follow-ups:

| Capability       | Change folders                                                       | Plan-review F | Impl-review F | Impl verdict               | Addendum in plan | Follow-ups |
| ---------------- | -------------------------------------------------------------------- | ------------- | ------------- | -------------------------- | ---------------- | ---------- |
| app-shell        | 2026-10-27-app-shell                                                 | 5             | 10            | NEEDS ATTENTION → APPROVED | no               | —          |
| auth             | 2026-10-27-role-based-signup                                         | 5             | 8             | NEEDS ATTENTION            | yes              | —          |
| agent-profile    | 2026-10-28-agent-profile                                             | 6             | 4             | APPROVED                   | no               | yes        |
| ranking          | 2026-10-28-offer-top3-ranking                                        | 5             | 6             | APPROVED                   | yes              | yes        |
| invitations      | 2026-10-28-agent-invitation, -invitation-response                    | 1, 5          | 4, 6          | APPROVED, (not grepped)    | no, no           | —          |
| account-deletion | 2026-10-28-account-deletion                                          | 3             | 6             | APPROVED                   | yes              | —          |
| offers           | 2026-10-29-owner-offer-management                                    | 3             | 3             | APPROVED                   | yes              | —          |
| platform         | 2026-10-29-testing-ranking-and-isolation, -testing-critical-path-e2e | 3, 3          | 5, 6          | (not grepped)              | yes, yes         | —          |

Prose churn (file changes under `context/`/`*.md`, counted commits): invitations 35, auth 23, ranking 21, offers 21, agent-profile 19, account-deletion 19 (incl. the audit, see mechanical), app-shell 17, platform 40, docs 60. Recent (10-29): offers, both testing changes, observability audit, agent hooks.

Lessons (`context/foundation/lessons.md`, 3 headings): token contrast (app-shell/shared), tick manual steps only after seeing the state (process, cross-cutting), verify email confirmation on production (auth).

## Debt markers

`git grep -E 'TODO|FIXME|HACK|XXX'` at HEAD: **0 hits** in code and in `context/` (0 per 1000 lines in every capability; tracked lines: platform 4053, invitations 3403, offers 2345, auth 1880, agent-profile 1529, account-deletion 1453, docs 1420, ranking 1250, app-shell 1194, shared 757, access 383). Inference: debt lives in review findings, follow-ups folders and the observability audit, not in code comments — the marker signal is empty, not reassuring.

## Mechanical signals

- **Closeout / review PRs per slice** (#9, 10, 12, 14, 16, 18, 21) and `fix(<id>): impl-review follow-ups` commits: workflow lockstep of the 10x chain, not breakage (false-signals 3, 5). Only auth's #4/#5 are fixes of production behaviour.
- **PR #7 closed unmerged**: superseded due to a conflict with the archived folder (workflow), re-landed as #10.
- **Revert d428be1 + red CI on PR #20**: deliberate break for a CI artifact (commit subject "TEMP deliberate break … (to be reverted)") — certification evidence, not a regression (rule 12).
- **Red CI on main 9e86c06**: CI bootstrap trial-and-error (rule 5).
- **PR #23 attributed to account-deletion**: the audit file name ends in `account-deletion` and matches glob `context/*/*account-deletion*`; the audit actually covers auth, access, offers, ranking, invitations and account-deletion (spillover, rule 12). Its findings are attributed by path above instead.
- **docs 20 PRs / platform 15 PRs**: every slice updates roadmap/plan and CI/test config (rule 4, 8) — not hot areas.
- **Cross-cutting PRs**: 11 of 22 merged PRs touch > 3 capabilities (slice PRs touch docs+platform+shared by design), so PR counts per capability overlap heavily.
- **Review findings are self-review** by the same author through agent skills (rule 7 spirit): they measure scrutiny applied, not independent disagreement.

## Unknowns

- No GitHub issues at all (0) — bug tracking, if any, lives elsewhere or nowhere; open-bug age is unknown.
- No human code review exists; review friction between people cannot be measured.
- Production errors: the audit states Workers Logs record almost nothing ("nic" in 8 of 9 failure shapes); no error tracker is wired, so production incidents are invisible to this scan.
- Ranking audit count 0 is an attribution artefact: ranking SQL lives inside offers/invitations migrations and the owner offer page (`src/pages/owner/offers/[id].astro`) maps to invitations, so ranking-related audit rows (RPC error → 200) land on invitations.
- O1/O2 list many endpoints/pages across offers, agent-profile and invitations; only paths prefixed with `src/` were attributed, so offers/agent-profile are undercounted there.
- Impl-review verdicts for invitation-response and the two testing changes not extracted (grep pattern miss).

## Commands run

- `gh pr list --state all --limit 100 --json …,reviews,comments,additions,deletions,headRefName,labels`; `gh issue list --state all --limit 100`; `gh pr view 7 --json comments,commits`; `gh run list --limit 100`; `gh run view <id> --json jobs` (2 failed runs)
- `git log --merges` + `git rev-list <m>^1..<m>^2` + `git show --name-only` → `attr.py` (`.work/pr-caps.json`)
- `git log --format=… | grep -iE 'revert|fix|review|follow…'`
- `grep '^### F'` / `Verdict` / `Addendum` over `context/archive/*/reviews/*.md` and `plan.md`; `grep '^#' context/foundation/lessons.md`; audit table rows → `attr.py`
- `git grep -nE 'TODO|FIXME|HACK|XXX' HEAD`; `git ls-files` line counts per capability via `attr.py`
