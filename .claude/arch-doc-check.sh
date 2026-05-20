#!/bin/bash
# PostToolUse hook: injects an additionalContext reminder when an architecture file is modified.
# Reads the Claude Code tool-use JSON from stdin.

FILE=$(jq -r '.tool_input.file_path // .tool_input.new_path // ""' 2>/dev/null)

ARCH_PATTERN='src/lib/engine/(feature-vector|linucb|thompson-sampling|epsilon-greedy|persona-discovery|persona-assignment|reward-calculator)\.ts|prisma/schema\.prisma|src/lib/braze/(client|payload-factory)\.ts'

if echo "$FILE" | grep -qE "$ARCH_PATTERN"; then
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Architecture file modified (%s). If this changes public behavior, data model, or algorithm interface, update the relevant docs: docs/bandit-engine.md, docs/persona-discovery.md, docs/system-overview.md, docs/data-flows.md, and/or docs/data-model.md."}}\n' "$FILE"
fi
