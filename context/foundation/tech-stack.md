---
starter_id: 10x-astro-starter
package_manager: npm
project_name: hellodom
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
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
---

## Why this stack

helloDOM is a web app with a one-week, after-hours MVP whose core needs are e-mail and password auth with two fixed roles, per-owner data isolation, and a deterministic agent-matching score. The 10x Astro Starter (Astro, React, TypeScript, Tailwind, Supabase, Cloudflare) is the recommended default for web apps in TypeScript, clears all four agent-friendly gates, and ships auth, a Postgres database and edge deployment out of the box, which matters most on a one-week timeline. Payments, realtime, AI and background jobs are out of scope per the PRD, so the edge-runtime limit on long-running tasks does not bite. The main gotcha to plan for is configuring row-level access rules early, since the PRD's guardrails depend on owners and agents seeing only their own data. Scaffolding confidence is first-class, so expect mostly smooth setup with occasional manual steps. Deployment targets Cloudflare Workers with static assets (the adapter no longer supports Pages), with GitHub Actions auto-deploying on merge to main.
