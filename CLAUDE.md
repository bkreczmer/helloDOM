# Repository Guidelines

helloDOM matches property owners' offers with real-estate agents (0–100 score, top 3, invitation flow). Product scope and rules live in `@context/foundation/prd.md`; the stack choice in `@context/foundation/tech-stack.md`.

## Hard rules

- Never commit secrets: they belong in `.env` / `.dev.vars` (both gitignored).
- Never commit `.claude/skills/*` (except `10x-impl-review-ci/`) or `PLAN.md`; see `@.gitignore`.
- Every new table needs RLS; owners see only their own offers, agents only offers they were invited to (PRD Guardrails).

## Commands

- `npm run dev` / `npm run build` / `npm run preview` — dev server (workerd), SSR build, preview
- `npm run lint` / `npm run lint:fix` — ESLint with type-checked rules
- `npm run format` — Prettier
- `npx astro check` — type check (run by CI)
- `npm run smoke` — auth smoke test against a running server (`BASE_URL`); run after dependency upgrades.

Pre-commit: husky + lint-staged (`@package.json`).

## Architecture

### Auth flow

- `src/lib/supabase.ts` — Supabase SSR client (`@supabase/ssr`, cookie sessions); secrets via `astro:env/server`.
- `src/middleware.ts` — sets `context.locals.user`; redirects anonymous users from `PROTECTED_ROUTES` to `/auth/signin`. Add every new gated route there.
- Endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`; pages: `src/pages/auth/`.

### Key conventions

- **`.tsx` vs `.astro`**: a `.tsx` component only when it has state (`useState`/`useReducer`) or an event handler; everything else is `.astro`. Use `client:load` only for such islands. Pattern: `src/components/auth/SignInForm.tsx` vs `src/components/Topbar.astro`.
- **Class names**: merge with `cn()` from `@/lib/utils`; never concatenate class strings.
- **shadcn/ui** ("new-york"): `src/components/ui/`; add via `npx shadcn@latest add [name]`.
- **API routes**: uppercase `GET`, `POST` exports; validate input with `z` from `astro/zod` (not a separate `zod` dependency).
- **Supabase migrations**: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`, with per-operation, per-role RLS policies.
- **React**: no "use client" directives; hooks in `src/components/hooks/`.
- **Business logic** in `src/lib/services/`; shared types and DTOs in `src/types.ts`.

### Environment

Setup lokalny i deploy: @README.md

## Testing

No test framework yet; `npm run smoke` and `npx astro check` are the only checks.

## CI

`@.github/workflows/ci.yml`: lint, `astro check`, build, plus a smoke job against a local Supabase. Runs on push and PR to `main`. Build needs `SUPABASE_URL` / `SUPABASE_KEY` repository secrets.

## Commits & change workflow

- Conventional Commits prefixes (e.g. `chore:`), as in `git log`.
- One folder per change in `context/changes/<change-id>/` (plan, research, reviews); foundation docs in `context/foundation/` are edited in place.
