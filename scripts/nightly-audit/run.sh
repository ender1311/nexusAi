#!/usr/bin/env bash
#
# Nexus nightly codebase audit — runs headless Claude Code against one rotating
# subsystem per night, has it (1) report bugs/perf findings and (2) sync the
# matching docs, then opens a single combined GitLab MR for human review.
#
# Designed to run unattended from a launchd LaunchAgent. It NEVER touches your
# live working tree: all work happens in a dedicated isolated clone under
# ~/.nexus-nightly-audit/repo. The MR is opened but NOT merged — findings are
# noisy by nature and want a human gate.
#
# Manual usage:
#   bash scripts/nightly-audit/run.sh            # full run (opens MR)
#   DRY_RUN=1 bash scripts/nightly-audit/run.sh  # edit + commit locally, no push/MR
#   SECTION=engine bash scripts/nightly-audit/run.sh  # force a subsystem
#
set -euo pipefail

# --- Fixed paths (launchd has a minimal env, so everything is absolute) -------
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
CLAUDE_BIN="${CLAUDE_BIN:-/opt/homebrew/bin/claude}"
GLAB_BIN="${GLAB_BIN:-/opt/homebrew/bin/glab}"
GIT_BIN="${GIT_BIN:-/usr/bin/git}"

REMOTE_URL="git@gitlab.com:lifechurch/youversion/marketing-group/nexus.git"
AUDIT_HOME="${HOME}/.nexus-nightly-audit"
REPO="${AUDIT_HOME}/repo"
LOG_DIR="${AUDIT_HOME}/logs"

DATE="$(date +%Y-%m-%d)"
DOW="$(date +%u)"   # 1=Mon ... 7=Sun
mkdir -p "$LOG_DIR"
LOG="${LOG_DIR}/audit-${DATE}.log"

# Everything below is logged to the per-day file (and stdout when run manually).
exec > >(tee -a "$LOG") 2>&1
echo "================================================================"
echo "Nexus nightly audit — $(date)"
echo "================================================================"

# --- Subsystem rotation -------------------------------------------------------
# One subsystem per weekday so the whole codebase is covered each week without
# re-auditing everything every night. Override with SECTION=<name>.
pick_section() {
  case "${1}" in
    1) SECTION="engine";       SECTION_LABEL="Bandit engine (Thompson/Epsilon/LinUCB, reward, arm-stats)";
       SECTION_PATHS="src/lib/engine/";
       SECTION_DOCS="docs/bandit-engine.md docs/thompson-sampling-model.md" ;;
    2) SECTION="api";          SECTION_LABEL="API route handlers (auth, contracts, validation)";
       SECTION_PATHS="src/app/api/";
       SECTION_DOCS="docs/api-routes.md" ;;
    3) SECTION="braze";        SECTION_LABEL="Braze integration (client, payload factory, analytics)";
       SECTION_PATHS="src/lib/braze/";
       SECTION_DOCS="docs/braze-integration.md docs/braze-sending-capabilities.md docs/braze-analytics-reward-pipeline.md" ;;
    4) SECTION="cron-sending"; SECTION_LABEL="Cron + send pipeline (select-and-send, send-grouping, scheduling)";
       SECTION_PATHS="src/lib/cron/ src/app/api/cron/";
       SECTION_DOCS="docs/send-timing-architecture.md docs/nexus-agent-targeting-spec.md" ;;
    5) SECTION="personas";     SECTION_LABEL="Persona discovery & assignment (HDBSCAN/k-means, feature vector)";
       SECTION_PATHS="src/lib/engine/persona-discovery.ts src/lib/engine/persona-assignment.ts src/lib/engine/feature-vector.ts src/lib/engine/user-stats.ts";
       SECTION_DOCS="docs/persona-discovery.md docs/personas.md" ;;
    6) SECTION="frontend";     SECTION_LABEL="Frontend (App Router pages + React components)";
       SECTION_PATHS="src/components/ src/app/";
       SECTION_DOCS="docs/system-overview.md" ;;
    7) SECTION="data-ingest";  SECTION_LABEL="Data layer + ingest (Prisma schema, ingest routes, db client)";
       SECTION_PATHS="prisma/schema.prisma src/app/api/ingest/ src/lib/db.ts";
       SECTION_DOCS="docs/data-model.md docs/data-flows.md docs/ingest-audiences.md docs/hightouch-sync-config.md" ;;
    *) echo "Unknown day-of-week '${1}'"; exit 1 ;;
  esac
}

if [[ -n "${SECTION:-}" ]]; then
  # Map a forced SECTION name back onto its config by scanning each day.
  forced="$SECTION"; unset SECTION
  for d in 1 2 3 4 5 6 7; do pick_section "$d"; [[ "$SECTION" == "$forced" ]] && break; done
  if [[ "$SECTION" != "$forced" ]]; then echo "Unknown SECTION '$forced'"; exit 1; fi
else
  pick_section "$DOW"
fi
echo "Subsystem: ${SECTION}  (${SECTION_LABEL})"
echo "Paths:     ${SECTION_PATHS}"
echo "Docs:      ${SECTION_DOCS}"

# --- Refresh the isolated clone to pristine origin/main -----------------------
if [[ ! -d "$REPO/.git" ]]; then
  echo "First run — cloning into ${REPO}"
  mkdir -p "$AUDIT_HOME"
  "$GIT_BIN" clone "$REMOTE_URL" "$REPO"
fi
cd "$REPO"
"$GIT_BIN" fetch origin --prune
"$GIT_BIN" checkout main
"$GIT_BIN" reset --hard origin/main
"$GIT_BIN" clean -fd

BRANCH="audit/nightly-${SECTION}-${DATE}"
"$GIT_BIN" branch -D "$BRANCH" 2>/dev/null || true
"$GIT_BIN" checkout -b "$BRANCH"

# --- Build the audit prompt ---------------------------------------------------
read -r -d '' PROMPT <<PROMPT_EOF || true
You are a senior staff engineer performing a focused nightly audit of the Nexus codebase.
Tonight's subsystem: ${SECTION_LABEL}.

Analyze ONLY these paths: ${SECTION_PATHS}

Do two things:

1. AUDIT for real defects. Look for correctness bugs, race conditions, N+1 query
   patterns, unbatched or blocking external API calls, missing AbortController
   timeouts, missing DB indexes on hot paths, unhandled error branches,
   type-safety holes (use of \`any\`), auth gaps, and performance problems.
   For each finding: cite the exact file:line, explain the concrete impact, and
   propose a specific fix. Rate severity P0/P1/P2/P3. Report ONLY issues you can
   substantiate from the code — no speculation. If the subsystem is clean, say so.

2. SYNC DOCS. Compare these docs against the current code and fix any drift, fill
   gaps, and improve clarity, editing them in place: ${SECTION_DOCS}

Write your audit report to docs/audits/${DATE}-${SECTION}.md (create docs/audits/
if needed) with: a one-line summary, a findings table (Severity | Location |
Issue | Suggested fix), and a "Docs updated" list.

HARD CONSTRAINTS:
- Edit files ONLY under docs/. Do NOT modify source code, tests, config, or schema —
  this is an audit; fixes land later under human review.
- Do NOT run git, glab, gh, or any commit/push/network/deploy command. The wrapper
  handles version control.
- Do NOT run tests, builds, migrations, or anything that touches a database.
- Never read or write .env*, failed.json, or any file containing secrets or PII.
- Follow the conventions in CLAUDE.md.
Work autonomously and finish in a single pass.
PROMPT_EOF

# --- Run headless Claude ------------------------------------------------------
echo "---- claude -p starting $(date) ----"
"$CLAUDE_BIN" -p "$PROMPT" --dangerously-skip-permissions || {
  echo "claude exited non-zero; aborting this run."
  cd "$REPO" && "$GIT_BIN" checkout main && "$GIT_BIN" branch -D "$BRANCH" 2>/dev/null || true
  exit 1
}
echo "---- claude -p finished $(date) ----"

# --- Discard anything Claude touched outside docs/ (stay docs-only) -----------
"$GIT_BIN" checkout -- . 2>/dev/null || true   # revert tracked non-docs edits
# Stage docs only.
"$GIT_BIN" add docs/

if "$GIT_BIN" diff --cached --quiet; then
  echo "No doc changes produced — nothing to open. Cleaning up."
  "$GIT_BIN" checkout main
  "$GIT_BIN" branch -D "$BRANCH" 2>/dev/null || true
  exit 0
fi

"$GIT_BIN" commit -m "audit(${SECTION}): nightly findings + doc sync (${DATE})

Automated nightly audit of ${SECTION_LABEL}.
Generated by scripts/nightly-audit/run.sh — review findings in
docs/audits/${DATE}-${SECTION}.md before acting on any code changes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "DRY_RUN=1 — committed locally on ${BRANCH}, skipping push/MR."
  "$GIT_BIN" --no-pager log --oneline -1
  exit 0
fi

# --- Push + open MR (not merged) ----------------------------------------------
"$GIT_BIN" push -u origin "$BRANCH" --force-with-lease
"$GLAB_BIN" mr create \
  --title "audit(${SECTION}): nightly findings + doc sync (${DATE})" \
  --description "Automated nightly audit of **${SECTION_LABEL}**.

Findings report: \`docs/audits/${DATE}-${SECTION}.md\`. Doc changes are bundled in
this MR. Review the findings before opening any follow-up code fixes — this MR
intentionally contains docs only.

Generated by \`scripts/nightly-audit/run.sh\`." \
  --yes || echo "MR may already exist for ${BRANCH}; continuing."

"$GIT_BIN" checkout main
echo "Done $(date)."
