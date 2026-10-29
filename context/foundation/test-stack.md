# Test stack

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.64.1
- config: playwright.config.ts
- single-spec command: npx playwright test tests/e2e/<name>.spec.ts
- full-suite command: npx playwright test
- base URL: http://localhost:4322
- port: 4322 (E2E_PORT from .env; detected default 4321 from the `astro preview` framework default, override with E2E_PORT)
- web server command: npm run build && npm run preview -- --port $E2E_PORT; reuseExistingServer outside CI
- auth setup project: setup (tests/e2e/auth.setup.ts), credentials from E2E_USERNAME / E2E_PASSWORD in .env (local user with the owner role)
- storageState: playwright/.auth/user.json (gitignored)
- seed: tests/e2e/seed.spec.ts — protects #2 (a signed-in owner must not reach the agent panel; role gate redirects to /owner)
- browser CLI: playwright-cli, command skill at .claude/skills/playwright-cli/SKILL.md
- updated: 2026-10-29
