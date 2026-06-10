# Interaction-flag targeting + 30-day post-release conversion attribution

**Date:** 2026-06-09
**Status:** Approved by Dan
**Driver:** Oracle agent must target only users with `votd_interaction_has_ever_flag = false`, convert when the flag flips to true, and keep crediting/counting those conversions even after the user exits a segment or is released from the agent.

## Background (verified in code, 2026-06-09)

- The 9 canonical `*_has_ever_flag` attributes live in `src/lib/constants/interaction-flags.ts` (synced from Hightouch via `POST /api/ingest/users`; absent warehouse values default to `false`). Reference list: `docs/json/hightouch-interaction-flags.json`.
- The segment field catalog (`src/lib/segments/field-catalog.ts`) does **not** include these flags, so no agent can target flag=false today.
- Flag-flip conversions are credited in `src/app/api/ingest/users/route.ts` (~lines 1080–1154) via `detectFlagConversions()` (`src/lib/services/interaction-conversion.ts`) + `applyConversion()` (`src/lib/services/attribution-service.ts`). The assignment lookup requires `releasedAt: null` — **a flip after release is silently dropped.**
- `UserAgentAssignment.externalUserId` is globally unique: a user has at most one assignment row ever. Re-enrollment by another agent overwrites the row (including `enrollmentFlags` baseline). `UserDecision` rows are immutable history.
- Dashboards (`src/lib/cache/performance.ts`, `src/lib/cache/dashboard.ts`) count `UserDecision.conversionAt` with no release filter — reporting needs no changes once crediting works.
- Oracle prod state: `draft`, continuous, funnelStage `wau`, includes `["new_user_21day_10percent"]`, one goal (`votd_interaction_has_ever_flag`, `first_interaction`, very_good, weight 5), **0 assignments, 0 decisions** — safe to reconfigure in place; do not delete.

## Decisions (user-approved)

1. **Attribution window:** a flag flip credits an agent up to **30 days after that agent's last send** to the user, regardless of release status.
2. **Reporting scope:** existing dashboards are sufficient; no new reporting UI.
3. **Targeting mechanism:** rule segments (catalog-driven), not a per-agent flag column and not auto-seeded segments.
4. **Oracle:** fix in production (reconfigure), do not delete/recreate.

## Part 1 — Targeting: interaction flags in the segment field catalog

Add the 9 interaction flags to `src/lib/segments/field-catalog.ts` as boolean fields:

- Import the canonical list from `src/lib/constants/interaction-flags.ts` — no duplicated string literals (contract-parity-via-source-of-truth pattern).
- Compile semantics: **absent/null = false**, mirroring the Hightouch `| default: false` template. SQL shape: `COALESCE((attributes->>'<flag>')::boolean, false)` — but must follow/extend the existing boolean-field compile strategy used by `has_recurring_gift` / `newsletter_push_enabled`, including type tolerance for `"false"`/`"true"` string values if the existing strategy handles them. If the existing strategy does NOT treat absent as false, add a boolean-with-default strategy rather than changing the semantics of existing fields.
- Fields appear automatically in the segment builder UI (catalog-driven dispatch).

Usage for Oracle: build rule segment **`votd-never-interacted`** = `votd_interaction_has_ever_flag is false`; Oracle includes become `["new_user_21day_10percent", "votd-never-interacted"]` (includes are ANDed).

Staleness note: rule segments materialize on the cron cadence. A user whose flag flips true remains in the materialized segment until the next materialization, but release-on-conversion releases them at credit time (same ingest request), so they don't keep receiving sends.

## Part 2 — Conversion: 30-day post-release tail attribution

In `POST /api/ingest/users`, per user, per flag that flipped false→true this sync:

1. **Active path (unchanged):** if the user has an active assignment (`releasedAt: null`), run `detectFlagConversions()` against its agent's goals + `enrollmentFlags` baseline, exactly as today.
2. **Tail path (new):** if the active path did not credit this flag (no active assignment, or active agent has no goal for this flag):
   - Find the user's most recent `UserDecision` where `conversionAt IS NULL`, `sentAt >= now − 30 days`, and the decision's agent has a goal with `eventName = <flag>` and `conversionType IS NOT NULL`.
   - Require an **observed false/absent → true transition vs the pre-upsert stored attributes** (the Type-B check). This is deliberately conservative: the tail path never credits a user whose stored flag was already true, even for `first_interaction` goals, because the enrollment baseline may no longer exist (assignment row overwritten).
   - Credit via `applyConversion()` on that decision.
   - **Most recent send wins** when multiple agents' decisions qualify.

Guard: `applyConversion()`'s release-on-conversion step must be scoped to `{ externalUserId, agentId: <credited agent>, releasedAt: null }`. A tail credit to agent A must never release the user from agent B's active assignment. (Verify current scoping; fix if it releases by user only.)

Non-goals / preserved behavior:
- No send → no credit: if the user has no qualifying decision, a flip is not credited (conversion = attributable to a message).
- Double-credit protection stays: `applyConversion` already guards with `conversionAt: null` (updateMany count check per the concurrent-retry pattern).
- Funnel-stage agents and non-flag goals are untouched.

## Part 3 — Reporting

No code changes. Tests pin that a tail-credited conversion shows up in the same `UserDecision.conversionAt`-based counts the dashboards read.

## Part 4 — Oracle production rollout (post-merge, manual ops)

1. Deploy the code.
2. In the Segments builder, create `votd-never-interacted` (`votd_interaction_has_ever_flag is false`); let it materialize.
3. Update Oracle: includes = `["new_user_21day_10percent", "votd-never-interacted"]`. Keep continuous mode, keep the existing `first_interaction` goal (with flag-false targeting every enrollee's baseline is false, so it behaves as intended).
4. Flip Oracle from draft when ready.

Lifecycle under this config: flag flips true → conversion credited at ingest + released (`conversion`); user ages out of the 21-day segment → `segment_exit` release, with late flips still credited for 30 days after the last send.

## Testing

- **Unit:** catalog compile for flag fields — absent = false, `"false"` string tolerance, operator set; byte-identical SQL compile guard (picker vs hand-built) extended to a flag field.
- **Regression (ingest):**
  - released user, flip within 30d of last send → credited; dashboards count it.
  - released user, flip at 31d → not credited.
  - flip with no prior send → not credited.
  - user re-enrolled by agent B (assignment row overwritten), flip within window of agent A's send but B's send is more recent and B tracks the flag → B credited (most-recent-send-wins).
  - tail credit to agent A while user actively enrolled with agent B → B's assignment NOT released.
  - stored flag already true, "flip" re-synced → no tail credit.
- **Regression (segments):** rule segment with a flag field materializes and an agent including it enrolls only flag-false users.
