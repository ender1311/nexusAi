#!/usr/bin/env bash
# PostToolUse hook: reminds Claude to write tests when API routes or pages with raw SQL are created/modified.
# Receives Claude Code tool-use event JSON on stdin.

FILE=$(jq -r '.tool_input.file_path // ""' 2>/dev/null)

# Nothing to check if we didn't get a file path
if [[ -z "$FILE" ]]; then
  exit 0
fi

REPO=$(git rev-parse --show-toplevel 2>/dev/null)
if [[ -z "$REPO" ]]; then
  exit 0
fi

# ── API route handler ─────────────────────────────────────────────────────────
if echo "$FILE" | grep -qE 'src/app/api/.+/route\.ts$'; then
  # Extract the first meaningful path segment after src/app/api/
  # e.g. src/app/api/agents/[id]/route.ts → agents
  ROUTE_NAME=$(echo "$FILE" | sed -E 's|.*src/app/api/([^/]+)/.*|\1|')

  INTEGRATION_DIR="$REPO/tests/integration"
  if [[ -d "$INTEGRATION_DIR" ]]; then
    MATCH=$(ls "$INTEGRATION_DIR" 2>/dev/null | grep -i "$ROUTE_NAME" | head -1)
  else
    MATCH=""
  fi

  if [[ -z "$MATCH" ]]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"[test-coverage] No integration test found for %s. Write one in tests/integration/ before this session ends. Route name to match: %s"}}\n' "$FILE" "$ROUTE_NAME"
  fi

  exit 0
fi

# ── Page component with raw SQL / Prisma queries ──────────────────────────────
if echo "$FILE" | grep -qE 'src/app/.+/page\.tsx$'; then
  FULL_PATH="$REPO/$FILE"
  # Also accept absolute paths as-is
  if [[ ! -f "$FULL_PATH" ]]; then
    FULL_PATH="$FILE"
  fi

  if [[ -f "$FULL_PATH" ]] && grep -qE '\$queryRaw|queryRawUnsafe' "$FULL_PATH"; then
    printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"[test-coverage] %s uses raw SQL queries. Add a regression test in tests/regression/ that exercises the exact SQL column names. Use the agents-unique-users-column.test.ts pattern."}}\n' "$FILE"
  fi

  exit 0
fi

exit 0
