---
bootstrapped_at: 2026-10-27T10:53:25Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: hellodom
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: hellodom
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

> helloDOM is a web app with a one-week, after-hours MVP whose core needs are e-mail and password auth with two fixed roles, per-owner data isolation, and a deterministic agent-matching score. The 10x Astro Starter (Astro, React, TypeScript, Tailwind, Supabase, Cloudflare) is the recommended default for web apps in TypeScript, clears all four agent-friendly gates, and ships auth, a Postgres database and edge deployment out of the box, which matters most on a one-week timeline. Payments, realtime, AI and background jobs are out of scope per the PRD, so the edge-runtime limit on long-running tasks does not bite. The main gotcha to plan for is configuring row-level access rules early, since the PRD's guardrails depend on owners and agents seeing only their own data. Scaffolding confidence is first-class, so expect mostly smooth setup with occasional manual steps. Deployment targets Cloudflare Pages, with GitHub Actions auto-deploying on merge to main.

## Pre-scaffold verification

| Signal      | Value                                                   | Severity | Notes                                                                 |
| ----------- | ------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| npm package | not run                                                 | —        | `cmd_template` starts with `git clone`; no npm CLI to check           |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-09-12 | fresh    | from card.docs_url; `gh` not authenticated, read via public GitHub API |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned `.git/` deleted before move-up)
**Exit code**: 0
**Files moved**: 22 top-level entries (.env.example, .github, .gitignore, .husky, .nvmrc, .prettierrc.json, .vscode, AGENTS.md, CLAUDE.md, README.md, astro.config.mjs, components.json, eslint.config.js, node_modules, package-lock.json, package.json, public, scripts, src, supabase, tsconfig.json, wrangler.jsonc)
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: moved silently (absent in cwd)
**.bootstrap-scaffold cleanup**: deleted

Install notes: Node v24.21.0, npm 11.19.0. npm reported that install scripts for 4 packages were not run because they are not covered by `allowScripts`: esbuild@0.28.2, esbuild@0.28.1, workerd@1.20260911.1 (postinstall), fsevents@2.3.3. Dev server and builds may fail until these are approved (`npm install-scripts approve <pkg>`).

## Post-scaffold audit

**Tool**: npm audit --json
**Summary**: 0 CRITICAL, 11 HIGH, 2 MODERATE, 1 LOW
**Direct vs transitive**: 0/1/0/1 direct of total 0/11/2/1 (direct: wrangler HIGH, astro LOW)

All 14 findings report a non-major fix available via `npm audit fix`.

#### CRITICAL findings

None.

#### HIGH findings

- **wrangler** (direct) 4.16.0 – 4.148.0, via miniflare. Fix available.
- **@cloudflare/vite-plugin** (transitive) 1.2.3 – 1.63.0, via miniflare, wrangler. Fix available.
- **miniflare** (transitive) 4.20250508.3 – 5.20261006.0-alpha, via sharp, undici. Fix available.
- **brace-expansion** (transitive) ≤1.1.20 / 4.0.0 – 5.0.11. GHSA-q2hr-2g5m-vwhr: quadratic-time expansion, CPU DoS. Fix available.
- **devalue** (transitive) ≤5.9.2. GHSA-j22f-vq7h-c4qm, GHSA-hx4r-w6wj-j8fg: shared-memory serialization; sparse-array CPU amplification. Fix available.
- **http-cache-semantics** (transitive) ≤4.2.0. GHSA-ch52-4w7c-c8xp: max-stale handling can disclose cross-user cached responses. Fix available.
- **sharp** (transitive) <0.35.5. GHSA-wq5f-xc86-pv6w: librsvg dependency CVE-2026-96889. Fix available.
- **source-map-js** (transitive) 1.0.0 – 1.2.1. GHSA-68fv-2mgg-jv7q: event-loop DoS via indexed source-map offsets. Fix available.
- **undici** (transitive) 7.0.0 – 7.30.0 / 8.0.0 – 8.12.1. GHSA-3wwx-pv8p-q78v, GHSA-pmjh-fq2x-6v4x: DoS in WebSocket decompression and RetryHandler. Fix available.
- **vite** (transitive) 8.3.0 – 8.3.2. GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw: launch-editor argument escaping / flag misinterpretation. Fix available.
- **zod** (transitive) <4.6.6. GHSA-mrhx-c7xc-m3w5: memory exhaustion validating oversized constrained collections. Fix available.

#### MODERATE findings

- **fast-uri** (transitive) 3.0.0 – 3.1.8. GHSA-hrr3-gc8f-f4qj, GHSA-w74x-v6f9-j3xg: host case normalization; scheme spoofing via percent-encoding. Fix available.
- **smol-toml** (transitive) ≤1.8.0. GHSA-r4xh-jqrq-34v2: quadratic-time parse. Fix available.

#### LOW / INFO findings

- **astro** (direct) 7.1.0 – 7.3.2. GHSA-mpr7-6m5w-76rw: arbitrary CSS injection in View Transitions. Fix available.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
