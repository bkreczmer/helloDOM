// Proof for the Claude Code hooks in .claude/hooks (configured in .claude/settings.json).
// Each case pipes a hook payload into the real script, inside a throwaway git repo.
// Only eslint and astro are stubs (node_modules/.bin): they flag the LINT_ERROR / TYPE_ERROR
// markers, so the cases run in milliseconds and without the real toolchain.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOKS = resolve(__dirname, "../../.claude/hooks");
const LINT = join(HOOKS, "lint-edited-file.sh");
const STOP = join(HOOKS, "end-of-turn.sh");
const SETTINGS = resolve(__dirname, "../../.claude/settings.json");

const ESLINT_STUB = `#!/bin/sh
echo "eslint $*" >> "$(dirname "$0")/../../calls.log"
rc=0
for f in "$@"; do
  case "$f" in -*) continue ;; esac
  if grep -q LINT_ERROR "$f" 2>/dev/null; then echo "$f  1:1  error  LINT_ERROR found"; rc=1; fi
done
exit $rc
`;
const ASTRO_STUB = `#!/bin/sh
echo "astro $*" >> "$(dirname "$0")/../../calls.log"
hits=$(grep -rl TYPE_ERROR src 2>/dev/null)
[ -z "$hits" ] && { echo "Result (1 file): - 0 errors"; exit 0; }
for f in $hits; do echo "$f:1:1 - error ts(2322): TYPE_ERROR"; done
exit 1
`;

let dirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A committed, clean repo with the stub toolchain (or none, for the no-silent-success case). */
function makeRepo(options: { tools?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "agent-hooks-"));
  dirs.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "hooks@example.com");
  git(root, "config", "user.name", "hooks test");
  writeFileSync(join(root, ".gitignore"), "node_modules/\ncalls.log\n");
  writeFileSync(join(root, "package.json"), '{ "name": "hooks-fixture", "private": true }\n');
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/clean.ts"), "export const ok = 1;\n");
  if (options.tools !== false) {
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
    for (const [name, body] of [
      ["eslint", ESLINT_STUB],
      ["astro", ASTRO_STUB],
    ]) {
      writeFileSync(join(root, "node_modules/.bin", name), body);
      chmodSync(join(root, "node_modules/.bin", name), 0o755);
    }
  }
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

function run(script: string, payload: unknown, cwd: string, env: Record<string, string> = {}) {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const result = spawnSync(script, { cwd, input, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: result.status, stderr: result.stderr, stdout: result.stdout };
}

function edit(root: string, file: string, extra: Record<string, unknown> = {}) {
  return { tool_name: "Edit", cwd: root, tool_input: { file_path: file }, ...extra };
}

function calls(root: string): string {
  try {
    return readFileSync(join(root, "calls.log"), "utf8");
  } catch {
    return "";
  }
}

beforeEach(() => {
  dirs = [];
});

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("lint-edited-file.sh (PostToolUse Write|Edit)", () => {
  it("blocks a broken file with exit 2 and names it on stderr", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src/broken.ts"), "const LINT_ERROR = 1;\n");
    const result = run(LINT, edit(root, join(root, "src/broken.ts")), root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("src/broken.ts");
    expect(result.stderr).toContain("LINT_ERROR");
  });

  it("lints .astro files too", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src/Page.astro"), "---\nconst LINT_ERROR = 1;\n---\n");
    expect(run(LINT, edit(root, join(root, "src/Page.astro")), root).code).toBe(2);
  });

  it("passes a clean file", () => {
    const root = makeRepo();
    const result = run(LINT, edit(root, join(root, "src/clean.ts")), root);
    expect(result).toMatchObject({ code: 0, stderr: "" });
  });

  it("skips uncovered types, missing files and payloads without a path", () => {
    const root = makeRepo();
    writeFileSync(join(root, "README.md"), "LINT_ERROR\n");
    expect(run(LINT, edit(root, join(root, "README.md")), root).code).toBe(0);
    expect(run(LINT, edit(root, join(root, "src/missing.ts")), root).code).toBe(0);
    expect(run(LINT, {}, root).code).toBe(0);
    expect(run(LINT, "not json", root).code).toBe(0);
    expect(run(LINT, { tool_name: "Bash", cwd: root, tool_input: { command: "ls" } }, root).code).toBe(0);
    expect(calls(root)).toBe("");
  });

  it("resolves a relative path against cwd and ignores CLAUDE_PROJECT_DIR", () => {
    const root = makeRepo();
    const other = makeRepo();
    writeFileSync(join(other, "src/clean.ts"), "const LINT_ERROR = 1;\n");
    const result = run(LINT, edit(root, "src/clean.ts"), root, { CLAUDE_PROJECT_DIR: other });
    expect(result.code).toBe(0);
    writeFileSync(join(root, "src/broken.ts"), "const LINT_ERROR = 1;\n");
    expect(run(LINT, edit(root, "src/broken.ts"), root, { CLAUDE_PROJECT_DIR: other }).code).toBe(2);
  });

  it("skips a broken file of another repository", () => {
    const root = makeRepo();
    const other = makeRepo();
    writeFileSync(join(other, "src/broken.ts"), "const LINT_ERROR = 1;\n");
    expect(run(LINT, edit(root, join(other, "src/broken.ts")), root).code).toBe(0);
  });

  it("fails visibly when the linter is not installed", () => {
    const root = makeRepo({ tools: false });
    const result = run(LINT, edit(root, join(root, "src/clean.ts")), root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("ESLint reported errors");
  });
});

describe("end-of-turn.sh (Stop)", () => {
  it("does nothing when the turn changed no file", () => {
    const root = makeRepo();
    expect(run(STOP, { cwd: root, stop_hook_active: false }, root).code).toBe(0);
    expect(calls(root)).toBe("");
  });

  it("blocks a lint error written without an edit hook (e.g. through a shell command)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src/clean.ts"), "export const LINT_ERROR = 1;\n");
    const result = run(STOP, { cwd: root, stop_hook_active: false }, root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("src/clean.ts");
    expect(result.stderr).toContain("ESLint errors in changed files");
  });

  it("blocks a type error reported by astro check", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src/typed.ts"), "export const x: number = 'TYPE_ERROR';\n");
    const result = run(STOP, { cwd: root, stop_hook_active: false }, root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("astro check fails");
    expect(result.stderr).toContain("src/typed.ts");
  });

  it("passes a clean change", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src/new.ts"), "export const fine = 2;\n");
    expect(run(STOP, { cwd: root, stop_hook_active: false }, root)).toMatchObject({ code: 0, stderr: "" });
  });

  it("lets the agent finish on the retry, even with the error still there", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src/clean.ts"), "export const LINT_ERROR = 1;\n");
    expect(run(STOP, { cwd: root, stop_hook_active: true }, root).code).toBe(0);
    expect(run(STOP, { cwd: root, loop_count: 1 }, root).code).toBe(0);
  });

  it("sweeps the session's checkout, not CLAUDE_PROJECT_DIR", () => {
    const root = makeRepo();
    const other = makeRepo();
    writeFileSync(join(other, "src/clean.ts"), "export const LINT_ERROR = 1;\n");
    expect(run(STOP, { cwd: root, stop_hook_active: false }, root, { CLAUDE_PROJECT_DIR: other }).code).toBe(0);
  });

  it("sweeps a sibling worktree registered by the per-edit hook for this session", () => {
    const root = makeRepo();
    const sibling = join(root, "..", `${root.split("/").pop() ?? "repo"}-wt`);
    dirs.push(sibling);
    git(root, "worktree", "add", "-q", sibling);
    // The stubs are gitignored, so the new worktree needs its own copy.
    mkdirSync(join(sibling, "node_modules/.bin"), { recursive: true });
    writeFileSync(join(sibling, "node_modules/.bin/eslint"), ESLINT_STUB);
    chmodSync(join(sibling, "node_modules/.bin/eslint"), 0o755);
    writeFileSync(join(sibling, "node_modules/.bin/astro"), ASTRO_STUB);
    chmodSync(join(sibling, "node_modules/.bin/astro"), 0o755);
    const session = `test-${Date.now()}`;
    // Clean edit in the sibling registers it; then the file is broken outside the hook.
    expect(run(LINT, edit(root, join(sibling, "src/clean.ts"), { session_id: session }), root).code).toBe(0);
    writeFileSync(join(sibling, "src/clean.ts"), "export const LINT_ERROR = 1;\n");
    const result = run(STOP, { cwd: root, session_id: session, stop_hook_active: false }, root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(sibling.split("/").pop());
  });

  it("fails visibly when the typechecker is not installed", () => {
    const root = makeRepo({ tools: false });
    writeFileSync(join(root, "README.md"), "changed\n");
    const result = run(STOP, { cwd: root, stop_hook_active: false }, root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("astro check fails");
  });
});

describe(".claude/settings.json commands", () => {
  it("reach the scripts from a worktree even with a stale CLAUDE_PROJECT_DIR", () => {
    const settings = JSON.parse(readFileSync(SETTINGS, "utf8")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    const commands = Object.values(settings.hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
    );
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      // A payload both scripts finish on at once (no path; retry flag): the script must be
      // found, executable and exit 0, without linting or typechecking this repo.
      const result = spawnSync("sh", ["-c", command], {
        cwd: resolve(__dirname, "../.."),
        input: '{"stop_hook_active":true}',

        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: "/nonexistent" },
      });
      expect(result.status, `${command}\n${result.stderr}`).toBe(0);
    }
  });
});
