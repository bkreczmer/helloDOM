#!/usr/bin/env bash
# PostToolUse (Write|Edit): lint the file the agent just edited.
# Exit 2 + stderr is the only combination Claude sees.
export NO_COLOR=1 FORCE_COLOR=0
command -v jq >/dev/null || { echo "Hook lint-edited-file.sh needs jq: install it or port the hook to Node." >&2; exit 2; }

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$FILE" ] || exit 0
case "$FILE" in /*) ;; *) FILE="${CWD:-$PWD}/$FILE" ;; esac

# Files eslint.config.js covers (typescript-eslint + eslint-plugin-astro) that still exist.
case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.astro) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] || exit 0

# Checkout of the edited file, not $CLAUDE_PROJECT_DIR (after EnterWorktree, or for a
# sibling worktree, that variable names another checkout). Files of other repositories
# (~/.claude, other projects) are skipped; any worktree of this repository is checked.
ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null) || exit 0
REPO=$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
SESSION_REPO=$(git -C "${CWD:-$PWD}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ -n "$REPO" ] && [ "$REPO" = "$SESSION_REPO" ] || exit 0
cd "$ROOT" || exit 0

# Register the checkout so the Stop hook sweeps it too, even when it is not the session cwd.
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')
if [ -n "$SID" ] && mkdir -p "${TMPDIR:-/tmp}/claude-hooks"; then
  printf '%s\n' "$ROOT" >>"${TMPDIR:-/tmp}/claude-hooks/$SID.roots"
fi

# Report only (no --fix): rewriting the file would break the agent's next Edit.
# --no-install: a linter that is not installed fails here (exit 2) instead of passing.
if ! OUTPUT=$(npx --no-install eslint --quiet "$FILE" 2>&1); then
  echo "ESLint reported errors in $FILE:" >&2
  echo "$OUTPUT" >&2
  exit 2
fi
exit 0
