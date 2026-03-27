#!/usr/bin/env bash
# Optional: sync Vercel *dashboard* project settings to Next.js (framework + no static output dir).
# Deployments already follow repo root vercel.json; use this if you want the UI to match.
#
#   export VERCEL_TOKEN="..."   # https://vercel.com/account/tokens
#   export VERCEL_TEAM_ID="..." # from: vercel project inspect <name> --scope <team> -d  (debug log: teamId=...)
#   export VERCEL_PROJECT_ID="..." # from same inspect (ID prj_...)
#
set -euo pipefail
TOKEN="${VERCEL_TOKEN:?Set VERCEL_TOKEN}"
TEAM_ID="${VERCEL_TEAM_ID:?Set VERCEL_TEAM_ID}"
PROJECT_ID="${VERCEL_PROJECT_ID:?Set VERCEL_PROJECT_ID}"

exec curl -sS -X PATCH "https://api.vercel.com/v9/projects/${PROJECT_ID}?teamId=${TEAM_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"framework":"nextjs","outputDirectory":null}'
