import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Local secrets (E2E_USERNAME, E2E_PASSWORD, app env) come from the gitignored .env.
// In CI the file is absent and the variables come from the job.
// The preview server itself (Cloudflare adapter) reads SUPABASE_* from .dev.vars.
if (existsSync(".env")) process.loadEnvFile(".env");

// 4321 is the default port of `astro preview` (astro.config.mjs sets no server.port).
// E2E_PORT overrides it when that port is taken on this machine (e.g. by `npm run dev`).
const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries, also in CI: a retry would hide flakiness (and re-run a serial beforeAll).
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Production-like build + preview, on the port above.
    command: `npm run build && npm run preview -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Astro 7 moves `astro preview` into a background daemon when it detects an agent;
    // keep it in the foreground so Playwright owns (and stops) the server.
    env: { ASTRO_PREVIEW_BACKGROUND: "1" },
  },
});
