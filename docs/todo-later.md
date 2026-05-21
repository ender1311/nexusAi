# To-Do Later

This file captures valuable follow-up work that should not be lost during active implementation. Remove items once they are shipped, intentionally rejected, or moved into a dated plan/spec.

## Workflow Convention

- Keep deferred product and engineering ideas in this file instead of scattering them across chat history.
- Each item should include the reason it matters, the current state, and what would make it done.
- Future automation: add a project hook that checks changed files and final agent responses for completed `To-Do Later` items, then reminds the agent to remove or update stale entries before finishing.

## Passive Push Observation Learning

**Why it matters:** Most Hightouch push-open rows are from non-Nexus sends. Those opens can teach Nexus what kinds of pushes users respond to, what send windows work, and which content categories resonate before Nexus has enough first-party sends to learn from scratch.

**Current state:**

- Hightouch push-open rows include identifiers and open timing such as `campaign_id`, `canvas_id`, `canvas_step_id`, `canvas_variation_id`, `canvas_step_message_variation_id`, `app_group_id`, `app_id`, `user_id`, `braze_user_id`, and `event_timestamp`.
- `src/app/api/ingest/users/route.ts` already accepts flat push-open rows.
- Exact canvas-step attribution currently works only when `canvas_step_id` maps to an existing `MessageVariant.brazeCanvasStepId`.
- Unmapped non-Nexus opens are mostly unmatched or only useful through coarse time-window attribution.
- Nexus does not currently persist a broad passive observation record for every push open.
- Nexus does not currently pull/store push title and body from Braze API in production. Existing copy enrichment comes from `scripts/seed-braze-canvas-inventory.ts`, which reads the Braze Push Canvas Inventory from Notion or CSV.

**Open questions:**

- Can Braze `/canvas/details` or `/campaigns/details` reliably expose push title/body for the relevant canvas step/message variation IDs, or should Notion/CSV remain the source of truth for copy?
- Can Hightouch provide push send/delivery events in addition to push opens? `event_timestamp` on the current rows is open time, not guaranteed send time.
- Should passive observations update only user/persona content-affinity features, or also warm-start variant arm stats when the content maps cleanly to a local variant?

**Done when:**

- A passive observation model/table records every push open idempotently, including raw Hightouch identifiers and open timestamp.
- Observations are enriched with title, body, category, subcategory, and action features when available.
- Send time is captured from a reliable send/delivery source, not inferred from open time.
- User/persona learning uses these observations to improve content-affinity and send-time priors.
- Unmatched observations remain useful instead of being discarded.

## Hightouch Sync Cost And Freshness

**Why it matters:** The current push-open sync can query millions of rows and deliver hundreds of thousands of operations per run. Changing the schedule from daily to every 4 hours or hourly may improve freshness, but it only saves money if it reduces total rows delivered or duplicate work.

**Current state:**

- Current Hightouch batch size is 1000 rows per HTTP request.
- Recent daily runs showed roughly 6.5M rows queried and anywhere from a few thousand to hundreds of thousands of successful operations.
- Vercel ingestion cost is driven by request count, function execution, transfer, and database work. More frequent syncs add fixed overhead unless they reduce duplicate rows.
- Hightouch cost is usually tied to rows delivered/operations, not only schedule frequency.

**Recommended direction:**

- Keep the sync daily unless freshness is causing a product issue.
- If fresher learning is needed, try 4-hourly before hourly.
- Make the sync truly incremental with a stable event primary key, preferably `push_notification_event_id`, and a timestamp/update filter that only sends new rows.
- Avoid sending fields Nexus does not use.
- Consider increasing batch size only after confirming Hightouch limits, Vercel request body limits, and endpoint memory/timeout behavior.

**Done when:**

- We know whether Hightouch charges are dominated by queried rows, successful operations, or both for this sync.
- The model only emits new or changed push-open events.
- The ingest endpoint logs enough detail to compare daily vs 4-hourly cost and freshness.
- A schedule choice is documented with actual operations/day and Vercel usage impact.
