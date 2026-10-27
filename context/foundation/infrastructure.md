---
project: hellodom
researched_at: 2026-10-27
recommended_platform: Cloudflare Workers (static assets)
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 7.4 (SSR) + React 19
  runtime: Cloudflare workerd via @astrojs/cloudflare 14.3.1 (wrangler 4.152)
---

## Recommendation

**Deploy on Cloudflare Workers (with static assets).**

Cloudflare is the only platform that passed all five agent-friendly criteria, and the project already runs on its adapter, so no migration is needed. The Free plan (100k requests/day, static assets free) covers the expected 10k–100k monthly requests at $0, which matches the interview priority of minimising cost, and the developer already knows the platform. Users are in one region and the data layer is external Supabase, so neither edge reach nor co-located databases tipped the score. The main cost of the choice is the Free plan's 10 ms CPU cap per request and the distance between the Worker and the Supabase region — both are in the risk register.

Note: `@astrojs/cloudflare` v14 no longer supports Pages; the project deploys as a Worker with static assets (`wrangler.jsonc`), and `tech-stack.md` now records `deployment_target: cloudflare-workers`.

## Platform Comparison

Hard filters: none removed (request/response only; every platform runs JS/TS). Soft weights: cost (heavy), prior Cloudflare familiarity (tie-breaker), single region (no edge bonus), external data layer (neutral). Research checked 2026-10-27.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total | MVP cost |
|---|---|---|---|---|---|---|---|
| Cloudflare Workers | Pass | Pass | Pass | Pass | Pass | 5 | $0 (Free) / $5 (Paid) |
| Vercel | Partial | Pass | Pass | Pass | Partial | 4 | $0 (Hobby, non-commercial) |
| Netlify | Partial | Pass | Pass | Pass | Pass | 4.5 | $0, functions in Ohio; EU region needs Pro $20 |
| Railway | Partial | Pass | Pass | Pass | Partial | 4 | ~$5 (Hobby) |
| Render | Partial | Pass | Pass | Pass | Partial | 4 | $0 with ~1 min cold start / $7 Starter |
| Fly.io | Partial | Partial | Pass | Pass | Partial | 3.5 | ~$2–5, no free tier |

- **Cloudflare**: `wrangler deploy`, `wrangler rollback`, `wrangler tail` cover the full loop; per-product `llms.txt`; MCP servers for docs and API (status unlabelled). Free plan: 100k req/day, 10 ms CPU/request.
- **Vercel**: `vercel rollback` on Hobby only reaches the previous production deploy; `vercel logs --follow` is deprecated (no live tail); Hobby keeps 1 h of logs. Vercel MCP launched as public beta, no GA announcement found. Hobby forbids commercial use. Needs `@astrojs/vercel` and `regions: ["fra1"]` (default is `iad1`).
- **Netlify**: rollback only via `netlify api` or UI; official MCP server. Free/Personal functions run only in US East (Ohio); EU region requires Pro. Free plan pauses all projects when 300 credits run out (each production deploy costs 15). Needs `@astrojs/netlify`.
- **Railway**: `railway up` / `logs`, but rollback is dashboard-only; MCP server status unstated. Always-on container in Amsterdam for ~$5. Needs `@astrojs/node`.
- **Render**: CLI has no rollback command (dashboard/API); free web service sleeps after 15 min with ~1 min wake; preview environments need Pro. Needs `@astrojs/node`.
- **Fly.io**: no rollback command (redeploy old image); MCP `[experimental]`; Warsaw region deprecated; Dockerfile required; no free tier.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Five passes, $0 at expected traffic, adapter already in place, `astro dev` already runs on workerd, and the developer knows the platform. Deterministic deploy and rollback from the CLI.

#### 2. Vercel

Free Hobby plan, Node functions in `fra1` next to an EU Supabase region, MCP and markdown docs. Loses on rollback depth and live logs on Hobby, the non-commercial clause, and an adapter switch.

#### 3. Railway

Always-on Node process in Amsterdam with no per-request CPU cap, `llms.txt` and an MCP server, for about $5/month. Loses on cost, dashboard-only rollback and an adapter switch to `@astrojs/node`.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. The Free plan caps CPU at 10 ms per request. Astro SSR plus `@supabase/ssr` cookie handling plus a JS-side ranking over many agents can exceed it and return error 1102 instead of a page; the only fix is the $5 Paid plan.
2. The Worker runs near the user while Supabase sits in one region; a ranking page with `getUser()` plus 2–3 sequential queries pays every round trip. Hyperdrive does not help REST-based supabase-js. Placement Hints (`placement.region`, changelog 2026-01-22) exist but their GA status could not be confirmed.
3. The recorded target (`cloudflare-pages`) no longer matches what the adapter supports, and `wrangler.jsonc` still names the Worker `10x-astro-starter`.
4. Preview URLs on workers.dev are public, are not visible in `wrangler tail` or Workers Logs, and by default talk to the same Supabase project as production.
5. Astro sessions default to a `SESSION` KV binding (eventually consistent up to 60 s, 1k writes/day on Free). The starter keeps sessions in Supabase cookies, so this only bites if `Astro.session` is introduced.

### Pre-Mortem — How This Could Fail

The team shipped helloDOM on the Workers Free plan because "it fits". Local development worked because `astro dev` also runs on workerd, but with tiny data. Once the JS ranking ran over a few hundred agents, the ranking page started returning 1102: the 10 ms CPU cap had only ever been tested on the sign-in page. The Paid upgrade happened the day before the deadline. Meanwhile every PR preview pointed at the production Supabase project, so test offers and accounts landed in the real database. A migration changed an RLS policy; `wrangler rollback` reverted the code but not the database, so the rollback "succeeded" while agents still saw other owners' offers. Finally, the Worker was still named `10x-astro-starter`, so the public URL in the submission carried the starter's name. None of it was the platform's fault — it came from assuming that the Free plan behaves like local dev, that previews are isolated, and that rollback covers data.

### Unknown Unknowns

- `wrangler rollback` reverts code only, within the last 100 versions; Supabase migrations and RLS policies must be rolled back separately.
- The Free daily limit (100k requests) resets at midnight UTC; requests over it fail rather than slow down.
- Workers Logs moves to Cloudflare Observability pricing on 2026-12-01.
- `@astrojs/cloudflare` v14 removed `Astro.locals.runtime`; read config via `astro:env` (already used by the starter) or `cloudflare:workers`. `astro dev` already runs on workerd, so a separate `wrangler dev` is unnecessary. Installed adapter is 14.3.1; latest is 14.4.2.
- The `name` in `wrangler.jsonc` sets the `*.workers.dev` URL; renaming after the first deploy creates a new Worker.

## Operational Story

- **Preview deploys**: `npx wrangler versions upload --preview-alias <branch>` publishes a version at `<alias>-hellodom.<subdomain>.workers.dev` without promoting it. Previews are public unless put behind Cloudflare Access; they must use a separate Supabase project or local data, never production keys.
- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` (anon key only, never the service-role key) live as Worker secrets via `npx wrangler secret put <NAME>`; locally in `.dev.vars` / `.env` (gitignored); CI secrets in GitHub repository secrets. Rotation: generate a new key in Supabase, `wrangler secret put`, redeploy.
- **Rollback**: `npx wrangler deployments list` then `npx wrangler rollback <version-id>`; takes seconds. Does not revert Supabase schema, RLS or data.
- **Approval**: a human approves production deploys from a local machine, secret rotation, Supabase migrations against the production project, and any data deletion. An agent may build, run `wrangler versions upload` for previews, and read logs unattended.
- **Logs**: `npx wrangler tail hellodom --format pretty` for live runtime logs; `npx wrangler deployments list` for deploy history; GitHub Actions logs via `gh run view --log`. Cloudflare's MCP server can read observability data as an alternative.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Free plan 10 ms CPU cap → error 1102 on ranking page | Devil's advocate | M | H | Compute the ranking in a Postgres function / single query instead of in JS; load-test the ranking page with realistic agent counts before the deadline; keep the $5 Paid plan as a ready fallback. |
| Latency from edge Worker to Supabase region | Devil's advocate | M | M | Keep each page to one or two Supabase calls; evaluate `placement.region` near the Supabase region once its status is confirmed. |
| Previews hit production Supabase | Pre-mortem | M | H | Point previews at a separate Supabase project or local stack; never upload production secrets to preview versions. |
| Rollback leaves RLS/schema changed | Pre-mortem / Unknown unknowns | M | H | Write a down migration for every RLS change; test RLS with integration tests before deploying. |
| Worker still named `10x-astro-starter` | Pre-mortem | — | L | Resolved 2026-10-27: `name` in `wrangler.jsonc` is `hellodom`. |
| Target recorded as Pages while adapter only supports Workers | Research finding | — | L | Resolved 2026-10-27: `tech-stack.md` `deployment_target` is `cloudflare-workers`. |
| Daily free limit exceeded (UTC reset) | Unknown unknowns | L | M | Watch request counts in the dashboard; upgrade to Paid if traffic approaches 100k/day. |
| `Astro.session` used without planning for KV limits | Devil's advocate | L | M | Keep auth state in Supabase cookies; if sessions are needed, budget for KV write limits. |
| Adapter version drift (14.3.1 vs 14.4.2) | Research finding | M | L | Upgrade `@astrojs/cloudflare` in a dedicated change and re-run `npm run smoke`. |

## Getting Started

1. Authenticate: `npx wrangler login` (uses the project's wrangler 4.152; no global install needed).
2. Set production secrets: `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` (anon key of the production Supabase project).
3. Build and deploy: `npm run build && npx wrangler deploy`, then open the printed URL — production is https://hellodom.hellodom.workers.dev (first deployed 2026-10-27).
4. Verify: `curl` the production URL and run `npx wrangler tail hellodom` while signing in. Run `npm run smoke` only against a non-production Supabase — it creates accounts.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
