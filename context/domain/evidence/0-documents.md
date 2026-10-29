# Sources: documents

- documents: 2 requirements, 13 narrative (11 archived change folders, roadmap, shape notes), 4 reference, 5 engineering

## Domain documents

| path                                                                                                                                                            | kind         | what it is about                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context/foundation/prd.md`                                                                                                                                     | requirements | product requirements: vision, personas, success criteria, user story, functional requirements, business logic of the score, access control, non-goals            |
| `context/foundation/shape-notes.md`                                                                                                                             | requirements | discovery notes the PRD was written from                                                                                                                         |
| `context/foundation/roadmap.md`                                                                                                                                 | narrative    | milestones and slices of the product                                                                                                                             |
| `context/archive/2026-10-27-role-based-signup/` … `2026-10-29-refactor-error-reporting/` (11 folders: change.md, research.md, plan.md, plan-brief.md, reviews/) | narrative    | one folder per delivered change: sign-up with roles, app shell, agent profile, offers, ranking, invitations, responses, account deletion, tests, error reporting |
| `README.md`, `CLAUDE.md`, `AGENTS.md`                                                                                                                           | reference    | product summary, architecture and conventions for contributors and agents                                                                                        |
| `supabase/seed.sql`                                                                                                                                             | reference    | seed data                                                                                                                                                        |
| `context/foundation/test-plan.md`                                                                                                                               | engineering  | risk map and test strategy (read for rules)                                                                                                                      |
| `context/foundation/lessons.md`                                                                                                                                 | engineering  | team lessons                                                                                                                                                     |
| `context/foundation/tech-stack.md`, `infrastructure.md`, `design-system.md`                                                                                     | engineering  | stack, deployment, visual design                                                                                                                                 |
| `context/audits/observability/2026-10-29_*.md`, `context/map/repo-map.md`                                                                                       | engineering  | observability audit, repository map                                                                                                                              |

## Product goals

- `context/foundation/prd.md:22` — „Właściciel nieruchomości, który postanowił ją sprzedać lub wynająć, nie wie, którego agenta wybrać.”
- `context/foundation/prd.md:24` — „helloDOM dobiera właścicielowi trzech najlepiej dopasowanych agentów.”
- `context/foundation/prd.md:36` — „Pierwszy przepływ (3 akcje do widocznej wartości): 1. rejestracja jako właściciel → 2. dodanie oferty → 3. ranking top 3 agentów z wynikiem 0–100. Przepływ domyka zaproszenie: właściciel zaprasza agenta, a agent przyjmuje albo odrzuca.”
- `context/foundation/prd.md:39-40` — primary success criteria (3 actions to ranking; accepted invitation moves the offer to „w obsłudze”).
- `context/foundation/prd.md:43` — secondary: „Właściciel rozumie, dlaczego agent dostał dany wynik.”
- `context/foundation/prd.md:46-48` — guardrails (no foreign offers; agent sees only invited offers; at most one accepted agent).
- `context/foundation/prd.md:126+` — non-goals.

## Change goals

Goals of single changes live in each archived `change.md` / `plan.md` (`context/archive/*/`); not used to judge the Core.

## Limitations

- Single author, 3-day history; the PRD and the change plans were written by the same person who wrote the code, so agreement between them is weaker evidence than in a multi-team product.
