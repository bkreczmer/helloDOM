# Evidence: people

- `evidence` Window: whole history 2026-10-27..2026-10-29 (3 days), head 899b986. 92 non-merge commits, 91 counted (bootstrap 858c0bb excluded as mass commit; lock file, generated `database.types.ts`, favicon excluded from paths). Attribution via `.work/attr.py`.
- `evidence` humans_in_window = **1** (`bkreczmer`, one identity, one name in non-merge history). **Small team — concentration is the baseline**; no statistic below is a finding about a person.
- `evidence` A second name, `bartek_dev`, appears only as author of 22 merge commits (committer `GitHub`, "Merge pull request #N from bkreczmer/..."); 0 non-merge commits. `inference`: GitHub merge-button identity of the same owner, not a second contributor. Excluded with the merges.
- `evidence` 66 of 91 counted commits (73%) carry `Co-Authored-By: Claude` — human-steered, counted as `bkreczmer`; reported below as activity context only.

## People per capability

High/medium criticality capabilities, plus `docs` (top 5 by commits). One person everywhere, so the table lists topic groups (commit scopes = change-ids) and period instead of a ranking.

| Capability (crit.)      | Commits | Person    | Topic groups (scopes / types)                                                                                                                                                  | Period       |
| ----------------------- | ------: | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| platform (high)         |      41 | bkreczmer | test tooling + CI from `testing-critical-path-e2e`, `testing-ranking-and-isolation`; config edits riding on feature slices (`role-based-signup`, `agent-profile`); agent hooks | 10-27..10-29 |
| invitations (high)      |      21 | bkreczmer | `agent-invitation`, `invitation-response` (invite / accept-reject RPCs, status lifecycle)                                                                                      | 10-28..10-29 |
| auth (high)             |      17 | bkreczmer | `role-based-signup` (8), confirmation callback + rate-limit fixes (4 `fix`)                                                                                                    | 10-27..10-28 |
| offers (high)           |      15 | bkreczmer | `owner-offer-management` (7), offer creation in `offer-top3-ranking` (4)                                                                                                       | 10-28..10-29 |
| ranking (high)          |      11 | bkreczmer | `offer-top3-ranking` (6) incl. 1 revert; ranking tests                                                                                                                         | 10-28..10-29 |
| account-deletion (high) |       7 | bkreczmer | `account-deletion` (5), observability audit                                                                                                                                    | 10-28..10-29 |
| access (high)           |       6 | bkreczmer | session/role gate from `role-based-signup`, isolation tests                                                                                                                    | 10-27..10-29 |
| shared (medium)         |      17 | bkreczmer | UI kit + dictionaries pulled in by `app-shell`, `agent-invitation`, `role-based-signup`                                                                                        | 10-27..10-29 |
| app-shell (medium)      |      13 | bkreczmer | `app-shell` (6), nav entries added by later slices                                                                                                                             | 10-27..10-29 |
| agent-profile (medium)  |       8 | bkreczmer | `agent-profile` (7)                                                                                                                                                            | 10-28        |
| docs (low, top 5)       |      46 | bkreczmer | archive moves (8), plan/PRD/test-plan edits per slice                                                                                                                          | 10-27..10-29 |

## Concentration

- `evidence` Every capability (11/11) has been touched by exactly one human. Bus factor = 1 for every capability — this is the project baseline (solo project), not a capability-specific risk (false-signal rule 6).
- `inference` No capability stands out relative to the team share (team share = 100%), so concentration gives no ranking signal for the map.

## Agent co-authorship

Share of counted commits per capability with a `Co-Authored-By: Claude` trailer (context, not a person):

| Capability       | Co-authored / commits | Share |
| ---------------- | --------------------: | ----: |
| access           |                   6/6 |  100% |
| ranking          |                 10/11 |   91% |
| shared           |                 15/17 |   88% |
| agent-profile    |                   7/8 |   88% |
| platform         |                 34/41 |   83% |
| offers           |                 12/15 |   80% |
| app-shell        |                 10/13 |   77% |
| invitations      |                 16/21 |   76% |
| auth             |                 12/17 |   71% |
| account-deletion |                   5/7 |   71% |
| docs             |                 26/46 |   57% |

- `inference` High and uniform shares across code capabilities reflect the workflow (agent-driven implement phases), not a property of any capability. Lower share in docs = hand-edited planning prose.

## Implications

- `evidence` Planning artifacts exist per slice in `context/archive/`: `2026-10-27-{app-shell,role-based-signup}`, `2026-10-28-{account-deletion,agent-invitation,agent-profile,invitation-response,offer-top3-ranking}`, `2026-10-29-{owner-offer-management,testing-critical-path-e2e,testing-ranking-and-isolation}` (research, plan, plan-review, impl-review).
- `inference` With one human, knowledge transfer runs through these folders, not through people: before changing a capability read its archive folder (plan + `reviews/impl-review.md`) and the matching PR:
  - auth / access → `2026-10-27-role-based-signup`, PRs #3, #4, #5; isolation → `2026-10-29-testing-ranking-and-isolation`, PR #19
  - offers → `2026-10-29-owner-offer-management`, PRs #17, #18
  - ranking → `2026-10-28-offer-top3-ranking`, PRs #8, #9
  - invitations → `2026-10-28-agent-invitation` + `2026-10-28-invitation-response`, PRs #11–#14
  - account-deletion → `2026-10-28-account-deletion`, PRs #15, #16
  - agent-profile → `2026-10-28-agent-profile`, PRs #6, #10
  - app-shell / shared → `2026-10-27-app-shell`, PR #2
  - platform → `2026-10-29-testing-critical-path-e2e` (PRs #20, #21), PR #1 (deploy), PR #22 (hooks)
- `inference` Gap: platform config edits made inside feature slices and `shared` UI-kit additions have no dedicated archive folder; their rationale is only in the slice that pulled them in.
- For any decision not written down: ask `bkreczmer`.

## Unknowns

- `evidence` No CODEOWNERS file (root or `.github/`). `unknown` Formal ownership beyond git authorship; no team roster.
- `unknown` Whether further contributors will join; all statistics describe a 3-day solo build.
- `unknown` Whether `bartek_dev` is definitively the same person (inferred from merge-only activity on `bkreczmer/*` branches).

## Commands run

- `python3 context/map/.work/people.py` (parses `.work/git-log.txt`, attributes via `attr.py`; output `.work/people-per-cap.txt`)
- `ls context/archive/ context/changes/`
- `git log --format='%aN' | sort | uniq -c`; `git log --merges --format='%aN|%cN'`; `git log --no-merges --author=bartek_dev`
- `gh pr list --state merged --limit 50 --json number,title`
