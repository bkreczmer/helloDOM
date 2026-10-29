import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Integration tests talk to the local Supabase over HTTP only, so the Astro config is not loaded.
// loadEnv with an empty prefix reads .env (local) and lets process env (CI) win over it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Only the keys that are set, so a missing one stays missing (and helpers report it) instead of "undefined".
  const supabaseEnv = Object.fromEntries(
    Object.entries(env).filter(([key]) => key === "SUPABASE_URL" || key === "SUPABASE_KEY"),
  );

  return {
    test: {
      // tests/hooks: proof for the Claude Code hooks in .claude/hooks (no Supabase needed).
      include: ["tests/integration/**/*.test.ts", "tests/hooks/**/*.test.ts"],
      environment: "node",
      // Test files share the auth rate limit of the local Supabase; run them one by one.
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 120_000,
      env: supabaseEnv,
    },
  };
});
