# Sources: code

- repo_root: /Users/bartlomiejkreczmer/Desktop/helloDOM
- code_scope: . (single application)
- head: b780d36 (clean)
- path_alias: none

## Stack

- TypeScript 6, Astro 7 (SSR, `output: "server"`) with React 19 islands, Tailwind CSS 4
- Supabase: Postgres (SQL migrations, RLS policies, PL/pgSQL functions called as RPC) + Supabase Auth
- Runtime: Cloudflare Workers (`@astrojs/cloudflare`)
- Tests: Vitest (integration against local Supabase, unit), SQL test scripts run with psql, Playwright E2E

## Layers

| layer             | path patterns                                                                                                                          | notes                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| entry points      | `src/pages/**/*.astro`, `src/pages/**/*.ts` (`src/pages/api/**` = form POST endpoints), `src/middleware.ts`                            | file-system routing; no jobs, queues, cron or webhooks                                                                                       |
| application logic | `src/lib/services/*.ts`, `src/lib/route-guard.ts`, `src/lib/report-error.ts`                                                           | pure functions: validation schemas, row-to-DTO mappers, result guards, error-code maps; Supabase calls live in pages and endpoints, not here |
| domain types      | `src/types.ts`, `src/lib/dictionaries.ts`, `src/db/database.types.ts` (generated from the schema)                                      | no separate domain-model layer — this is a finding, not a gap                                                                                |
| persistence       | `supabase/migrations/*.sql` (tables, check constraints, indexes, triggers, RLS policies, functions), `supabase/seed.sql`               | business rules are partly enforced here (functions, constraints, policies)                                                                   |
| UI                | `src/components/**` (`.astro` and React `.tsx`), `src/layouts/**`, `src/styles/global.css`                                             | user-facing copy is inline Polish text in components and in message maps under `src/lib/services/`                                           |
| tests             | `supabase/tests/*.sql`, `tests/integration/*.test.ts`, `tests/unit/*.test.ts`, `tests/e2e/*.spec.ts`, `scripts/smoke.mjs` (HTTP smoke) |                                                                                                                                              |

## Excluded

| path                                                        | reason                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `context/domain/`, `context/archive/*-domain-distillation/` | earlier distillations (none yet)                           |
| `context/**`                                                | documents, not code — read by the docs agent only          |
| `.claude/**`, `.github/**`, `.husky/**`, `tests/hooks/**`   | developer tooling and agent configuration, not the product |
| `src/db/database.types.ts`                                  | generated (read only to confirm schema names)              |
| `node_modules/`, `dist/`, `.astro/`                         | dependencies and build output                              |
| `CLAUDE.md`, `AGENTS.md`, `README.md`                       | reference documents, read by the docs agent only           |
