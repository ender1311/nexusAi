# Production Readiness — Mock to Real Users

This document describes every step required to move Nexus from its current state (mock/static UI data) to a fully operational bandit optimization system running on real users with Hightouch feeding signals in and out.

---

## The Full Loop

```
Hightouch (data warehouse)
    → [sync users]       → Nexus /api/ingest/users
                         → Nexus assigns user to persona
                         → Nexus selects variant (bandit)
                         → Braze sends message to user
                         → User converts (app event)
                         → Event warehouse / Braze Currents
    → [stream events]    → Nexus /api/ingest/events
                         → Reward calculated + stored
                         → PersonaArmStats updated (bandit learns)
                         → Loop
```

---

## Gap Analysis — What's Missing Today

| What | Status |
|---|---|
| PostgreSQL DB + schema | Ready, needs deploy |
| `/api/ingest/users` | Working |
| `/api/ingest/events` (partial) | Reward stored, **arm never updated** |
| `/api/decide` (variant selection) | **Does not exist** |
| Send cron | **Does not exist** |
| Hightouch user sync | Not configured |
| Hightouch event streaming | Not configured |
| Braze firing | Client exists, nothing calls it |
| UI wired to real data | Mock everywhere except `/personas` |

---

## Step 1 — Deploy the Database

The PostgreSQL migration is ready (`prisma/migrations/_init_pg`). Point `DATABASE_URL` at a real Postgres instance (Neon, Supabase, or Railway all deploy cleanly on Vercel).

```bash
DATABASE_URL=postgresql://... npx prisma migrate dev
npx prisma generate
```

Set `DATABASE_URL` in Vercel environment variables for all environments (production, preview, development).

---

## Step 2 — Build `/api/decide`

This is the most critical missing piece. The Thompson Sampling and Epsilon-Greedy engines exist in `src/lib/engine/` but are never called from an API route. Nothing selects variants or records decisions today.

**New route: `POST /api/decide`**

Request:
```json
{ "agentId": "...", "externalUserId": "..." }
```

Response:
```json
{ "brazeVariantId": "...", "messageVariantId": "...", "channel": "push" }
```

Logic:
1. Look up (or create) `User` by `externalId`
2. Run `assignUserToPersona(externalId)` → get `personaId`
3. Load `PersonaArmStats` for `(personaId, agentId, all variants)`
4. Run the agent's algorithm (Thompson or Epsilon-Greedy) → pick `variantId`
5. Seed missing `PersonaArmStats` rows with `alpha=1, beta=1` on first encounter
6. `INSERT UserDecision { userId, agentId, variantId, sentAt: now() }`
7. Return `{ brazeVariantId, messageVariantId, channel }`

Also apply scheduling rules before returning — check quiet hours, frequency caps, and blackout dates from `SchedulingRule`. Return `{ suppressed: true }` if the user should not receive a message right now.

---

## Step 3 — Fix the Reward Loop in `/api/ingest/events`

`/api/ingest/events` already calculates rewards and updates `UserDecision`, but it **never touches `PersonaArmStats`**. The bandit's Beta distribution parameters (`alpha`/`beta`) never change, so the algorithm never actually learns.

After the existing reward calculation block, add:

```typescript
// After reward is calculated and UserDecision updated:
const user = await prisma.user.findUnique({
  where: { externalId },
  select: { personaId: true }
});

if (user?.personaId && decision.messageVariantId) {
  await prisma.personaArmStats.upsert({
    where: {
      personaId_agentId_variantId: {
        personaId: user.personaId,
        agentId: decision.agentId,
        variantId: decision.messageVariantId,
      }
    },
    update: {
      alpha: { increment: reward > 0 ? reward : 0 },
      beta:  { increment: reward <= 0 ? 1 : 0 },
      tries: { increment: 1 },
      wins:  { increment: reward > 0 ? 1 : 0 },
    },
    create: {
      personaId: user.personaId,
      agentId: decision.agentId,
      variantId: decision.messageVariantId,
      alpha: reward > 0 ? 1 + reward : 1,
      beta:  reward <= 0 ? 2 : 1,
      tries: 1,
      wins:  reward > 0 ? 1 : 0,
    }
  });
}
```

---

## Step 4 — Set Up Hightouch User Sync (Reverse ETL)

This hydrates `User` records in Nexus with behavioral attributes so persona assignment has real feature data.

In Hightouch:
1. **Create a Model** — SQL query against your user warehouse table. Should join behavioral attributes (content preferences, session frequency, channel opt-ins, etc.) into a flat row per user.
2. **Create a Destination** — HTTP Request, pointing at `https://your-nexus.vercel.app/api/ingest/users`
3. **Set the auth header** — `Authorization: Bearer <INGEST_API_KEY>`
4. **Map columns**:
   - Primary key → `external_user_id`
   - All attribute columns → nested under `attributes` object
5. **Schedule** — Daily or hourly depending on how fresh persona features need to be

The endpoint handles batches natively (`{ users: [...] }`), so Hightouch can send full batch payloads.

Example payload shape:
```json
{
  "users": [
    {
      "external_user_id": "usr_abc123",
      "attributes": {
        "preferred_content": "devotionals",
        "sessions_per_week": 5,
        "channel_opt_ins": ["push", "email"],
        "account_age_days": 180
      }
    }
  ]
}
```

---

## Step 5 — Set Up Hightouch Event Streaming (Conversion Events)

This closes the reward loop. When a user starts a Bible plan (or any goal event), the event must stream back into Nexus so it can be attributed to the message variant that caused it and used to update the bandit.

**Option A — Hightouch Event Sync** (if events live in your data warehouse):
- Point at `POST /api/ingest/events`
- Map: `external_user_id`, `event_name`, `timestamp`, `properties`
- Set same `Authorization: Bearer <INGEST_API_KEY>` header
- The 48-hour attribution window is already handled server-side

**Option B — Braze Currents** (if conversion events come through Braze):
- Build a thin adapter route `POST /api/ingest/braze-currents`
- Translate Currents event format → Nexus event format
- Forward to the same reward calculation logic

Example event payload:
```json
{
  "external_user_id": "usr_abc123",
  "event_name": "plan_started",
  "timestamp": "2026-04-14T09:30:00Z",
  "properties": {
    "plan_id": "bible_in_a_year",
    "plan_value": 0.8
  }
}
```

---

## Step 6 — Build the Send Cron

Nothing currently calls `BrazeClient` to fire messages. The `PayloadFactory` and `BrazeClient` exist in `src/lib/braze/` but are never invoked.

**New route: `POST /api/cron/select-and-send`**

Secure with `Authorization: Bearer <CRON_SECRET>`. Wire to Vercel Cron in `vercel.json`:

```json
{
  "crons": [{ "path": "/api/cron/select-and-send", "schedule": "0 9 * * *" }]
}
```

Logic:
1. Fetch all `active` agents
2. For each agent, fetch target personas via `AgentPersonaTarget`
3. Fetch all users assigned to those personas
4. For each user, call `/api/decide` logic (inline, not HTTP) to get `brazeVariantId`
5. Apply scheduling rules — skip suppressed users
6. Bucket users by `brazeVariantId`
7. For each bucket, call `BrazeClient.post('/messages/send', PayloadFactory.build(...))`
8. Record the Braze `send_id` back on each `UserDecision`

For scale (2.5M users), process in batches of 50 users per Braze API call and use Vercel's streaming response or a queue to avoid timeouts.

---

## Step 7 — Hightouch Signals Back Out

Once Nexus has made enough decisions to accumulate meaningful stats, Hightouch can read that data and push it back into Braze as user attributes — enabling Braze-native segmentation driven by the bandit's learnings.

**7a — Persona Assignments → Braze**
- Hightouch reads `User.personaId` + `User.personaConfidence` from the Nexus DB (or via `GET /api/users/:id`)
- Syncs `nexus_persona_id` and `nexus_persona_confidence` as Braze custom attributes
- Braze segments and Canvases can now filter by persona without any code changes

**7b — Winning Variants → Braze**
- Hightouch reads `PersonaArmStats` — when `alpha / (alpha + beta)` is meaningfully higher for one variant across a persona, that's the winner
- Syncs `nexus_preferred_variant` per persona into Braze
- Can be used to lock in winners in Braze's own A/B system

**7c — Suppression Lists**
- Users where `totalReward / totalDecisions < smartSuppressThreshold` should stop receiving messages
- Hightouch reads this from the `User` table and syncs a `nexus_suppressed: true` attribute to Braze
- Add to Braze global control group or canvas exit criteria

---

## Environment Variables Checklist

```bash
# Database
DATABASE_URL=postgresql://...

# Braze
BRAZE_API_KEY=...
BRAZE_REST_URL=rest.iad-01.braze.com
BRAZE_ANDROID_APP_ID=...
BRAZE_IOS_APP_ID=...
BRAZE_WEB_APP_ID=...

# Ingest security (Hightouch uses this as Bearer token)
INGEST_API_KEY=...

# Cron security
CRON_SECRET=...
```

---

## Critical Path (Ordered)

1. **Deploy DB** — everything else depends on this
2. **Build `/api/decide`** — no decisions are being made without this
3. **Fix arm update in `/api/ingest/events`** — bandit never learns without this
4. **Configure Hightouch user sync** — persona assignment needs real feature vectors
5. **Configure Hightouch event streaming** — reward loop needs real conversion events
6. **Build send cron + wire Braze** — the actual message delivery
7. **Hightouch signals out** — persona/winner attributes back to Braze for segmentation

Items 2 and 3 can be done in parallel. Items 4 and 5 can be configured in parallel once the DB is up.
