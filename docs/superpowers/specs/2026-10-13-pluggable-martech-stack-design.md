# Pluggable Martech Stack: Design

**Date:** 2026-10-13
**Status:** Draft, awaiting review
**Scope:** Umbrella architecture. Each phase (P0–P7) gets its own implementation plan.

## 1. Goal

Turn Nexus from a YouVersion + Braze + Hightouch app into an AI decisioning service that plugs into any martech stack:

- **Any CDP or data source.** Pushed data (Hightouch, Segment, webhook, CSV) and pulled data (Snowflake, BigQuery, Postgres) both work.
- **Any sender.** Orchestrated sends through any ESP or channel provider (Braze, Iterable, Customer.io, OneSignal, Twilio, SendGrid), plus pull-based decision APIs, batch exports and webhooks.
- **Multi-tenant SaaS first.** The same code still deploys as a single-tenant self-host, where workspace count = 1.
- **YouVersion is tenant #1.** It stays live in production throughout the migration.

### Decisions made during brainstorming

| Question | Decision |
|---|---|
| Who it's for | Both SaaS and self-host, SaaS-first. Every row is workspace-scoped; a self-host has one workspace. |
| What "pluggable DB" means | The **customer data source** is pluggable. Nexus's own state (config, decisions, arm stats) stays on Postgres behind repositories. Supporting other internal databases is out of scope. |
| Integration modes | All four: orchestrated send, Decision API (pull), batch decision export, outbound webhooks. |
| YouVersion | Workspace #1 on the shared codebase. Its domain logic moves into a `youversion` vertical pack. |
| Architecture | **Approach A:** ports and adapters inside the existing Next.js monolith, with a durable queue at the connector I/O boundary. We rejected splitting into separate services (B, premature) and delegating all vendor I/O to unified pipes (C, which depends on competitors and loses control of send timing). |
| First connectors | Braze, Hightouch, Segment, generic webhook/CSV, Snowflake, BigQuery, Iterable, Customer.io, OneSignal, Twilio, SendGrid. They ship in waves (§9). |

### Non-goals (v1)

- Running Nexus's internal state on MySQL, SQL Server, DynamoDB and the like.
- Vertical packs other than `generic` and `youversion`.
- Copying the full warehouse into Nexus. Nexus copies only the fields a workspace maps.
- A visual journey builder. Customers keep their ESP's journeys and use the Decision API inside them.

## 2. Current state (audit summary, 2026-10-13)

**Sending**
- Bandits, caps, quiet hours and send-time optimisation all run in-app.
- Braze is called only from `sendVariantGroup` (`src/lib/cron/send-grouping.ts:286`), demo send (`src/app/api/demo/send`) and push-summary (`src/app/api/metrics/push-summary`).
- Braze-specific features we rely on: `in_local_time`, `*/schedule/create` (schedules are never cancelled), content cards through a Liquid `api_trigger_properties` template, and slideup and modal messages through prebuilt Canvases.
- Braze names leak into the database: `brazeSendId`, `brazeScheduleId`, `brazeAnalyticsFetchedAt`, `brazeVariantId`, `brazeCanvasStepId`, `brazeCampaignId`, `brazeCanvasId`, `TrackedUser.brazeId`, `FailedBrazeSend`.
- The caps treat `brazeSendId IS NOT NULL` as "send accepted".
- "Delivered" only means Braze returned HTTP 200. No delivery receipts come back.

**Feedback**
- Opens and clicks come back through Braze Currents, either directly (`ingest/braze-events`) or relayed through Hightouch (`ingest/users`).
- Attribution takes the most recent unresolved decision in the last 48h. It does not match on a send ID.

**CDP**
- Hightouch's API is used only by the management UI. All data arrives by push into `/api/ingest/*`.
- There's no Zod validation in ingest. `ingest/users`, at 1,463 lines, sniffs which of three payload shapes it received.
- One global key handles ingest auth (`INGEST_API_KEY`/`HIGHTOUCH_API_KEY`).
- Identity is keyed on `externalId`. Unverified users use their Braze ID as `externalId`.

**Database**
- Postgres only: 36 models, about 30 raw SQL sites using jsonb, `ON CONFLICT`, `FILTER`, `TABLESAMPLE` and `EXPLAIN`.
- No repository layer: 62 of 76 API routes and 17 of 36 pages import `@/lib/db` directly.
- No tenant concept.
- `User` has about 39M rows and `UserDecision` about 35M.

**YouVersion leakage into the core**
- Feature-vector dims [7] (giving) and [8] (spiritual depth).
- The plan-persona classifier.
- The funnel stages `dau4/wau/mau`.
- The long-horizon plan events and the gift reward modifiers.
- The 10 interaction flags.
- The hardcoded segment field catalog.
- VOTD, guided prayer, verse and USFM content.
- The plan-set sync.

**Bugs found along the way**
- **LinUCB lost updates.** `updateLinUCBArm` (`src/lib/arm-stats.ts:113-169`) reads the arm, updates it in JS, then writes it back with no lock or version.
- **Spiritual depth reads missing keys.** Dim [8] (`src/lib/engine/feature-vector.ts:123-128`) reads `gp_current_month_count`, `gs_current_month_count` and `badge_lifetime_count`. Ingest only supplies the `*_current_year_count` keys, so three of the five inputs are probably always 0.

## 3. Design principles

1. **The engine stays pure.** `src/lib/engine/` never imports a vendor or connector.
2. **One canonical event model.** Every adapter translates into it, so reward logic is written once.
3. **Exact attribution.** `decisionId` round-trips through every activation mode. Matching by time window is a labeled fallback.
4. **Capabilities, not vendor checks.** Behaviour branches on the declared capabilities, never on `if (vendor === "braze")`.
5. **Workspace scoping everywhere.** Data, cache tags, locks, queues, credentials and metrics are all per workspace.
6. **Verticals are packs.** Domain logic is a plugin. The core works for a customer with zero domain fields.
7. **Migrate in place.** Every phase ships to production. YouVersion's behaviour is checked against tests that record today's output.

## 4. Core contracts

### 4.1 Connector manifest

```ts
// src/connectors/types.ts
type ConnectorKind = "source" | "ingest" | "activator" | "engagement";

type ConnectorManifest = {
  id: string;                        // "braze", "iterable", "segment", "snowflake", …
  displayName: string;
  kinds: ConnectorKind[];
  configSchema: z.ZodType;           // drives onboarding form + validation
  secretKeys: string[];              // config keys stored encrypted
  capabilities: {
    channels?: Channel[];            // "push" | "email" | "sms" | "in_app" | "content_card" | "webhook"
    scheduling?: "none" | "absolute" | "local_time";
    cancel?: boolean;
    metadataPassthrough?: boolean;   // can carry decisionId into engagement events
    contentModes?: ("rendered" | "provider_template")[];
    maxBatch?: number;
    rateLimit?: { rps: number; burst: number };
    engagementDelivery?: "webhook" | "poll" | "stream" | "none";
  };
  healthCheck(config: unknown): Promise<HealthResult>;
};
```

The registry lives at `src/connectors/registry.ts` and maps `id → { manifest, factories }`.

### 4.2 Ports

```ts
interface DataSource {               // pull: warehouses, CDP profile APIs
  listFields(): Promise<FieldDef[]>;
  readProfiles(q: ProfileQuery): AsyncIterable<CanonicalProfile>;   // incremental by cursor
  readAudience(ref: string): AsyncIterable<Identity>;
  writeDecisions?(rows: DecisionExportRow[]): Promise<void>;        // batch-export mode
}

interface IngestTranslator {         // push: Hightouch, Segment, webhook, CSV
  verify(req: Request, conn: Connection): Promise<boolean>;         // vendor signature or connection token
  translate(body: unknown): TranslateResult;                        // { events: CanonicalEvent[]; rejects: Reject[] }
}

interface Activator {                // orchestrated send + webhook-out
  send(batch: ActivationBatch): Promise<ActivationResult[]>;        // per decision
  cancel?(providerScheduleId: string): Promise<void>;
}

interface EngagementTranslator {     // Braze Currents, Iterable/SendGrid/Twilio webhooks…
  verify(req: Request, conn: Connection): Promise<boolean>;
  translate(body: unknown): EngagementEvent[];
}
```

### 4.3 Canonical events

```ts
type Identity = {
  userId?: string;
  anonymousId?: string;
  aliases?: Record<string, string>;  // { braze: "65ab…", email: "a@b.com", segment_anon: "…" }
};

type CanonicalEvent =
  | { type: "profile"; eventId: string; identity: Identity; traits: Record<string, JsonValue>; at: Date }
  | { type: "track"; eventId: string; identity: Identity; name: string; props: JsonObject; at: Date }
  | { type: "audience"; eventId: string; identity: Identity; audience: string; op: "enter" | "exit"; at: Date }
  | EngagementEvent;

type EngagementEvent = {
  type: "engagement";
  eventId: string;
  identity: Identity;
  kind: "delivered" | "open" | "click" | "bounce" | "unsubscribe" | "complaint" | "dismiss";
  channel: Channel;
  decisionId?: string;               // present when provider passed metadata through
  providerMessageId?: string;
  at: Date;
};
```

All translators validate with Zod. Payloads that fail validation go to a dead-letter store, not a silent skip.

### 4.4 Decision lifecycle

```
decided ──► activated(mode, connectionId, providerMessageId?) ──► delivered? ──► engaged / converted ──► rewarded
   │
   └──► expired (never activated) ──► excluded from learning
```

- **`UserDecision` gains:**
  - `activationMode`: `orchestrated | api | batch | webhook`
  - `connectionId`, `activatedAt`, `deliveredAt`, `expiresAt`
  - `attribution`: `exact | windowed`
- **Attribution order:** match by `decisionId` first, then `providerMessageId`, then the user's most recent activated decision within the goal's window. The last one is labeled `windowed`.
- **Rewards and penalties only apply to activated decisions.** A decision that expires unused never gets a negative reward. Penalizing it would bias the bandit toward whichever arms happened to get activated.
- **`reward-calculator.ts` doesn't change.** A new `src/server/reward/` service feeds it canonical events.

## 5. Tenancy, credentials, data model changes

### 5.1 Workspaces

- **New models:**
  - `Workspace { id, slug, name, plan, packs: string[], settings Json, createdAt }`.
  - `Membership { workspaceId, workosUserId, role }`.
- **Each workspace is a WorkOS Organization.** WorkOS org membership replaces `ALLOWED_DOMAINS`. Roles (admin, copywriter, library editor) become per membership.
- **Every model gets `workspaceId`.** Global unique keys become composite: `(workspaceId, externalId)`, `(workspaceId, name)`, `(workspaceId, key)` and so on.
- **Migrating the large tables:**
  1. `ALTER TABLE … ADD COLUMN "workspaceId" text NOT NULL DEFAULT '<yv-workspace-id>'`. On PG 11+ this only changes metadata.
  2. `CREATE INDEX CONCURRENTLY` the composite indexes.
  3. Swap the unique constraints.
  4. Drop the default once all writers set the value.

### 5.2 Isolation (layered)

1. **Repositories.** New code under `src/server/repos/` uses `db.forWorkspace(wsId)`, a Prisma `$extends` that adds `workspaceId` to every where, create and upsert. An ESLint `no-restricted-imports` rule bans `@/lib/db` outside `src/server/repos/`. Existing direct imports are allowlisted and burned down route by route.
2. **Raw SQL.** It goes through a `wsSql(wsId)` tagged-template helper that always binds `workspaceId`. A regression test fails if a raw query in `src/` doesn't reference it.
3. **Postgres RLS.** Enabled after layer 1 is complete, on `User`, `UserDecision`, `PersonaArmStats`, `UserArmStats`, `LinUCBArm` and `UserSegment`, using `current_setting('app.workspace_id')` set per transaction.
4. **Runtime.**
   - Cache tags become `ws:{id}:<tag>`, with helpers in `src/lib/cache/index.ts`.
   - The cron lock key is per workspace.
   - `select-and-send` becomes a dispatcher that enqueues one job per `(workspace, agent)`, so a large tenant can't starve the others.

### 5.3 Connections and secrets

- **`Connection { id, workspaceId, connectorId, name, config Json, secretsCiphertext bytes, keyVersion int, status, lastHealthAt, lastHealthError }`**
- **Envelope encryption:**
  - Each workspace has a data key (DEK), wrapped by a master key (KEK) from env `NEXUS_KEK_v{n}`.
  - Secrets are encrypted with AES-256-GCM, and `keyVersion` allows rotation.
  - The KEK can move to an external KMS later without a schema change.
  - Secrets are never returned to the client. The UI shows only whether each one is set.
- **Ingest endpoints** are per connection: `POST /api/v1/ingest/{connectionId}` and `POST /api/v1/engagement/{connectionId}`.
  - Auth is a per-connection bearer token, stored only as a SHA-256 hash, or the vendor's own signature scheme (Segment, Iterable, SendGrid, Twilio).
  - The old `/api/ingest/*` routes stay as aliases bound to YouVersion's Hightouch and Braze connections until Hightouch is repointed.

### 5.4 Moving off Braze names (expand, then contract)

| Today | Target | Method |
|---|---|---|
| `UserDecision.brazeSendId` | `providerMessageId` | Prisma `@map("brazeSendId")`; no data change |
| `UserDecision.brazeScheduleId` | `providerScheduleId` | `@map` |
| `UserDecision.brazeAnalyticsFetchedAt` | `rewardResolvedAt` | `@map` |
| caps check `brazeSendId IS NOT NULL` | `activatedAt IS NOT NULL` | new column; backfill in batches from `sentAt` where `brazeSendId` is set; rebuild the partial indexes concurrently; then switch the queries |
| `Message.brazeCampaignId/brazeCanvasId`, `MessageVariant.brazeVariantId/brazeCanvasStepId` | `ProviderBinding { id, workspaceId, connectionId, messageId?, variantId?, contentMode, refs Json }` | new table; backfill; dual-read; drop the old columns in a later phase |
| `TrackedUser.brazeId` | `IdentityAlias { workspaceId, userId, namespace, value }`, unique `(workspaceId, namespace, value)` | new table; backfill `namespace='braze'`; generalize the reconciliation in `ingest/users` |
| `FailedBrazeSend` | `ActivationFailure { …, connectionId, retryable, providerError }` | new table; dual-write; then drop |
| Braze env vars | `Connection` config for YouVersion's Braze connection | seed script; env is a fallback until P2 is done |

### 5.5 Caps in Decision API mode

The customer's ESP does the sending, so Nexus can't strictly enforce frequency caps. It evaluates caps at decision time and returns `action: "suppress"`, and a decision counts as activated when it's fetched. The agent UI labels caps as **advisory** for agents in API mode.

## 6. Data flow

### 6.1 Push ingest

`POST /api/v1/ingest/{connectionId}`:
1. Verify the request, translate it with Zod, write an `IngestBatch` record, enqueue the batch, and return `202 { accepted, rejected }`.
2. The worker:
   1. Skips duplicates on `(workspaceId, eventId)`, using `ProcessedEventId` with `workspaceId` added.
   2. Resolves identity: `userId`, then `IdentityAlias` lookup, then an anonymous-to-known merge (the reconciliation logic, generalized).
   3. Applies the event:
      - **`profile`:** merges traits into `User.attributes`. Derived fields (recency, preferred hour) are computed through `FieldDef` derivations.
      - **`audience`:** upserts or deletes `UserSegment` with `source = connectionId`.
      - **`track`:** looks up the goal in `GoalMapping`. On a match it calls the reward service (attribution in §4.4). It always updates the user stats.
      - **`engagement`:** sends the event to the reward service and updates delivery status.
   4. Bumps the `last_user_ingest_at` marker per workspace.

### 6.2 Pull sources (warehouse)

- **Connection config:** connection details, a profile table or query, the identity column, a cursor column (e.g. `updated_at`), field mappings, optional audience queries, and a schedule.
- **The sync job** reads incrementally since the stored cursor. It selects **only mapped columns**, emits `profile` and `audience` events into the same pipeline as §6.1, and stores the new cursor.
- **Audiences** can be copied this way, or set to `evaluate_at_enrollment` and queried fresh when the agent enrolls users.
- **Why copy at all:** send-time decisioning needs low-latency feature reads, and a query to the warehouse per user is too slow and too expensive. The warehouse stays the source of truth; Nexus holds a cache of the mapped fields.

### 6.3 Schema and goal registries (per workspace)

- **`FieldDef { workspaceId, key, type: string|number|boolean|date|enum, source: "attribute"|"column"|"derived"|"engagement", pii: bool, facetable, segmentable, enumValues? }`**
  - It replaces the hardcoded `src/lib/segments/field-catalog.ts`.
  - `compile-sql.ts` takes its casts and allowed operators from the registry.
  - Unknown traits are stored but can't be used in segments until declared, or until a type is inferred from samples and confirmed in the UI.
- **`GoalMapping { workspaceId, eventName, goal, weight, windowHours, polarity }`**
  - It replaces `LONG_HORIZON`, the hardcoded `push_disabled = -1`, and the plan and gift event lists.
  - The no-response penalty (today −0.35 after 48h, in `cron/ingest-braze-analytics`) becomes a per-goal setting. It only applies to activated decisions with no bounce.
- **Seeding:** a new workspace's registries start from its packs (§7).

### 6.4 Activation modes

**Orchestrated send**
1. The per-agent job runs today's selection: enrollment, lottery, caps, quiet hours, bandit, scheduling. It writes `UserDecision` rows with state `decided`.
2. The decisions are grouped into `ActivationBatch` jobs keyed by `(connectionId, channel, variantId, sendAt)` and enqueued.
3. The worker calls `Activator.send`. It sets `activatedAt` and `providerMessageId` on success, and writes an `ActivationFailure` on error.
4. The worker follows each connector's `rateLimit`. On a 429 it retries with backoff and jitter; a 5xx is retried a limited number of times.
5. `decisionId` goes into each provider's metadata:

   | Provider | Field |
   |---|---|
   | Braze | push `extra`, `trigger_properties` / `canvas_entry_properties` |
   | Iterable | `dataFields` |
   | Customer.io | message `data` |
   | SendGrid | `custom_args` |
   | Twilio | `StatusCallback` query parameter |
   | OneSignal | `data` |

6. **Scheduling:** when `capabilities.scheduling === "local_time"`, Nexus passes the scheduling through to the provider, as with Braze `in_local_time`. Otherwise Nexus computes a UTC `sendAt` per user from `timezone`, and the queue job is delayed until then. Because Nexus then holds the schedule, cancel works with every provider.

**Decision API**
- **Request:** `POST /api/v1/decide`, authenticated with a workspace API key.
  ```json
  { "agent": "…", "user": { "userId": "…" }, "context": { "channel": "push", … } }
  ```
- **Response:**
  ```json
  { "decisionId": "…", "action": "send" | "suppress", "reason": "…",
    "variant": { "id": "…", "content": { … rendered … } }, "sendAt": "…" }
  ```
- **Braze Connected Content form:** `GET /api/v1/decide?agent=…&user=…`, with the token in a header.
- **Hosting:** in `apps/api` (Hono).
- **Latency:** the target is p99 < 150 ms. User features and arm stats are read from a short-TTL cache (Redis through the Vercel Marketplace, or in-process LRU), with stale-while-revalidate.
- **Activation:** the decision is marked activated when it's fetched.

**Batch export**
- A scheduled job per agent decides for its audience and writes `DecisionExportRow { userId, decisionId, agent, variantId, content, sendAt, validUntil }`.
- The destination is `DataSource.writeDecisions` (a warehouse table), a CDP trait (e.g. a Segment identify with `nexus_next_message`), or a file (CSV/Parquet to object storage).
- A decision counts as activated once an engagement event or an explicit activation callback references it. Unused decisions expire at `validUntil` and are excluded from learning.

**Outbound webhooks**
- The decision and its rendered content are POSTed to a URL the customer configures.
- The signature is `X-Nexus-Signature: t=…, v1=HMAC-SHA256`.
- Failures are retried with exponential backoff for up to 24h, then go to a dead-letter queue the UI can show and replay.
- A 2xx response means activated.

### 6.5 Content modes

Content mode is set per `ProviderBinding`:
- **`rendered`:** Nexus resolves every token and sends final copy. This is the default and matches today's push and email sends.
- **`provider_template`:** Nexus sends the provider's template, campaign or Canvas ID plus properties. This covers today's content cards and slideup/modal Canvases, and any ESP whose in-app messages need its own templates.
- **Token rules:**
  - Nexus tokens use a namespace (`{{user.first_name}}`, `{{yv.votd.text}}`) and pack resolvers fill them at decision time.
  - The existing guard against unresolved `{{` (`hasUnsubstitutedTokens`) stays for `rendered` mode.
  - Provider-native template syntax (Liquid) is allowed only in `provider_template` mode.

### 6.6 Engagement and reward

- `POST /api/v1/engagement/{connectionId}` runs the `EngagementTranslator`, then the reward service.
- **Delivery status:** `delivered`, `bounce` and `complaint` set it on the decision. The sends UI shows real delivery state, replacing today's "Delivered" that only meant Braze returned HTTP 200.
- **Opens and clicks** become rewards through the goal mapping. Arm stats are updated with the existing `upsertArmStats` and `upsertUserArmStats` calls, now scoped by workspace.
- **`unsubscribe` and `complaint`** apply the configured negative reward and update the user's channel opt-out.

### 6.7 Concurrency fix

`LinUCBArm` gains a `version int` column. `updateLinUCBArm` does a compare-and-swap update (`WHERE version = $v`), retrying up to 5 times with fresh reads. Reward events for the same arm are also serialized through the queue's per-key ordering where available.

## 7. Vertical packs

```ts
// src/packs/types.ts
type VerticalPack = {
  id: "generic" | "youversion";
  fields: FieldDef[];
  goals: GoalMapping[];
  features: FeatureExtractor[];
  lifecycle?: { stages: StageDef[]; classify(u: UserView): string };
  personaClassifier?: PersonaClassifier;
  contentResolvers?: ContentResolver[];
  rewardModifiers?: RewardModifier[];
  widgets?: DashboardWidget[];
  jobs?: ScheduledJob[];
};
type FeatureExtractor = { key: string; extract(u: UserView): number }; // normalized 0..1
```

**Feature sets**
- An agent's feature set is the ordered union of its workspace's packs' extractors, saved as `Agent.featureSet { keys: string[]; hash: string }`.
- `LinUCBArm` is keyed by `(workspaceId, agentId, variantId, featureSetHash)`.
- Changing the feature set starts new arms. The old ones are kept read-only for analytics.
- k-means persona discovery is already independent of dimension count.

**`generic` (every workspace)**
- **Features:** `push_conv_rate`, `email_conv_rate`, `morning_share`, `evening_share`, `weekend_share`, `overall_conv_rate`, `recency`, `frequency`. These are today's dims [0]–[6] and [9], computed from Nexus's own history.
- **Lifecycle:** `new / active / at_risk / lapsed`, defined by recency thresholds.
- **Goals:** `engaged` (open/click) and `converted` (mapped events).
- **Fields:** `email`, `first_name`, `timezone`, `language_tag`, `country`, channel opt-ins, `last_seen_at`.

**`youversion` (workspace #1)**
- **Features:** `giving_tier` and `spiritual_depth`. Fix the input-key bug and add a regression test that links to it.
- **Persona classifier:** the plan-persona classifier, with `PlanSet` lookup.
- **Lifecycle:** `dau4 / wau / mau / lapsed_*`, with a mapping to the generic stages. `channel-preference.ts` keeps its window logic through the pack.
- **Fields:** the 10 interaction flags, plan, guided prayer, guided scripture, badge and giving attributes, `preferred_bible_version_id`.
- **Goals:** `plan_completed`, `plan_read_day_3`, `plan_read_day_7` (720h window), `gift_given`, `sower_subscribed`, `push_disabled` (−1).
- **Content resolvers:** VOTD, guided prayer, verse content, verse images, USFM, translation resolver, giving copy and handles.
- **Widgets:** giving and gift metrics.
- **Jobs:** plan-set sync, VOTD/GP refresh.
- **Code layout:** the code moves to `src/packs/youversion/`. YouVersion-only routes return 404 unless the workspace has the pack enabled. Its tables (`PlanSet`, `PlanSetMember`, `VotdDailyContent`, `GuidedPrayerDailyContent`) get `workspaceId`.

## 8. Connectors (v1 target set)

| Connector | Kinds | Notes |
|---|---|---|
| Braze | activator, engagement | `local_time` scheduling, cancel, `provider_template` for content cards and Canvases; Currents for engagement |
| Hightouch | ingest (+ management UI) | translator covers the current `ingest/users`, `events`, `audiences`, `segments` shapes; management UI becomes the connector's settings panel |
| Segment | ingest, (source via Profiles API later) | Track/Identify/Group spec; Segment webhook signature |
| Generic webhook / CSV | ingest | documented canonical JSON; CSV upload with column mapping |
| Snowflake | source (+ batch export destination) | key-pair auth; incremental cursor; `writeDecisions` to a table |
| BigQuery | source (+ batch export destination) | service account; incremental cursor; `writeDecisions` |
| Iterable | activator, engagement | `dataFields` passthrough; system webhooks |
| Customer.io | activator, engagement | transactional/broadcast API; reporting webhooks |
| OneSignal | activator, engagement | push; `data` passthrough |
| Twilio | activator, engagement | SMS; status callbacks |
| SendGrid | activator, engagement | email; `custom_args`; Event Webhook (signed) |

## 9. Phasing

Each phase has its own implementation plan. Every phase ships to production with YouVersion live.

| Phase | Delivers | Exit criterion |
|---|---|---|
| **P0: Safety net** | Tests that record today's output for the Braze payloads `select-and-send` + `send-grouping` build from fixed fixtures, and for decisions under a seeded RNG. LinUCB compare-and-swap fix. Dim [8] key fix. | Recorded outputs green; regression tests for both bugs. |
| **P1: Foundation** | `Workspace`/`Membership` with YouVersion as default, `workspaceId` everywhere, repositories + lint rule, `wsSql`, `Connection` + envelope encryption, `@map` renames, `activatedAt`, `IdentityAlias`, `ProviderBinding`, `ActivationFailure`, per-workspace cache tags and locks, dependency-boundary lint rules (§13.3). | No direct `@/lib/db` imports outside repos (allowlist empty); isolation suite green. |
| **P2: Ports + first adapters** | `src/connectors/` registry; `Activator(braze)` extracted from `send-grouping`; `IngestTranslator(hightouch)`; `EngagementTranslator(braze-currents)`; `decisionId` passthrough; queue in place for ingest and activation; per-workspace dispatcher; legacy route aliases; `DecisionPolicy` port wrapping the three existing algorithms with provenance on each decision; `select-and-send` split into `Pipeline` stages (§13.4); versioned canonical events and connector config (§13.2). | Recorded outputs still green; production shows a share of `attribution = exact`. |
| **P3: Packs + registries** | `generic` and `youversion` packs; `FieldDef` and `GoalMapping` registries seeded from packs; `featureSet` + `featureSetHash` arms; segment compiler on the registry. | YouVersion feature vectors match the pre-refactor output except for the dim [8] fix. |
| **P4: Activation modes** | Decision API (`apps/api`), outbound webhooks, batch export, advisory caps label, per-workspace flags, policy shadow mode. | Decision API p99 < 150 ms under load test; webhook replay works. |
| **P5: Connectors wave 1** | Segment, generic webhook/CSV, Iterable, Snowflake. | Conformance kit green; a demo workspace runs Segment → Nexus → Iterable end to end. |
| **P6: Connectors wave 2** | Customer.io, BigQuery, OneSignal, Twilio, SendGrid. | Conformance kit green. |
| **P7: Product surface** | Connection onboarding wizard generated from `configSchema`; self-serve signup; usage metering (decisions/month, monthly tracked users); audit log; per-workspace export and delete (GDPR/CCPA); Postgres RLS turned on. | A new tenant onboards without a developer. |

## 10. Testing

- **Recorded-output tests (P0).** Freeze the current behaviour before refactoring. They live in `tests/characterization/`.
- **Connector conformance kit.** `tests/connectors/conformance.ts` exports `runConnectorConformance(entry, fixtures)`. Every connector must pass these checks:
  - the config schema accepts good fixtures and rejects bad ones;
  - translators turn recorded real vendor payloads (`tests/fixtures/connectors/<vendor>/`) into the expected canonical events;
  - `decisionId` round-trips;
  - translation is idempotent;
  - backoff on 429 and bounded retry on 5xx, tested against an HTTP mock;
  - `cancel` and `local_time` behave as declared, if the connector claims them.
- **Fake adapters.** `InMemoryActivator`, `InMemoryDataSource` and `FakeEngagementSource` are used by engine, integration and isolation tests.
- **Workspace isolation suite.** Seeds two workspaces and runs every repository method from each side, asserting that nothing crosses over. It's generated from the repository registry, so new methods are covered automatically.
- **Live sandbox smoke tests.** Nightly, and only when vendor sandbox credentials are present.
- **Existing rules still apply.** Every new endpoint gets an integration test, every engine function a unit test, every bug fix a regression test, and every raw SQL statement a column regression test.

## 11. Observability

Per connection: health status, ingest lag, accepted versus rejected counts, dead-letter depth, activation success rate, 429 rate, and attribution split (exact versus windowed). Per workspace: decisions per day, activations, rewards, and queue depth. This is surfaced on the existing Data Ingest page, which becomes a "Connections" page.

## 12. Risks

1. **The `select-and-send` refactor** (2,124 lines). P0's recorded-output tests are the main protection. Pieces are extracted one seam at a time.
2. **Decision API latency.** Feature and arm caches. Load test before GA.
3. **Warehouse cost and PII.** Only mapped columns are selected. Fields flagged `pii` are encrypted at rest. Retention is configurable per workspace.
4. **Migration risk on the 35M-row and 39M-row tables.** Metadata-only `ADD COLUMN`, `CREATE INDEX CONCURRENTLY`, batched backfills, and `@map` renames instead of physical renames.
5. **Queue semantics.** Delivery is at-least-once, so every consumer must be idempotent. That's enforced by `eventId`/`decisionId` uniqueness.
6. **IP and data ownership (non-technical, blocks P7).** This repo runs YouVersion production, with about 39M users, from a personal repo. Before onboarding outside tenants, settle code ownership and licensing with YouVersion. Also agree on data isolation: YouVersion's data stays in its own workspace, and possibly its own database or Neon project.

## 13. Evolvability (built to change)

The system has to absorb many iterations: new vendors, new channels, new algorithms, new verticals, and changing vendor APIs. None of these should mean editing the core. The rules below make that hold.

### 13.1 Everything that varies is a registry entry

| Varies over time | Extension point | Adding one means |
|---|---|---|
| Vendors | `src/connectors/<id>/` + `registry.ts` entry | One folder: manifest, adapters, fixtures. No core edits. |
| Channels | `Channel` registry with per-channel content schema (Zod) | One channel definition; activators declare support through capabilities |
| Decision algorithms | `DecisionPolicy` port: `select(ctx, arms) → choice`, `update(arm, reward)`, `stateSchema` | Thompson, ε-greedy and LinUCB become three policies; a new one (contextual Thompson, an LLM-generated variant policy) is a new file |
| Features | `FeatureExtractor` in packs | One function |
| Verticals | `VerticalPack` | One folder under `src/packs/` |
| Goals and rewards | `GoalMapping` rows + `RewardModifier` in packs | Data, not code |
| Fields | `FieldDef` rows | Data, not code |
| Activation modes | `ActivationMode` handlers behind the `Activation` service | One handler |

Registries are plain typed maps checked at build time, not runtime plugin loading. A typo is a compile error, and adding an entry never needs a deploy-time config change.

### 13.2 Contracts are versioned

- **Canonical events** carry `schemaVersion`. Translators emit the current version. The pipeline has upcasters (`v1 → v2`), so stored or replayed events from older versions still process. A breaking change adds a version; it never edits one in place.
- **Connector config** carries `configVersion`, and each connector ships `migrateConfig(from, to)`. Stored `Connection.config` is upgraded lazily on read and written back.
- **Policy state** (arm stats, LinUCB matrices) carries `policyId` + `stateVersion`. Changing a policy's state shape ships a migration, or starts fresh arms keyed by the new version, as with `featureSetHash`.
- **Public APIs** (`/api/v1/decide`, ingest, webhooks out) are path-versioned. `v1` gets additive changes only. Breaking changes go to `v2`, which runs alongside `v1` for a published deprecation window. Outbound webhook payloads carry `apiVersion`, pinned per subscription.
- **Each decision records its provenance:** `policyId`, `policyVersion`, `featureSetHash`, `packVersions`, `contentVersion` (the variant revision). That lets any decision be reproduced or audited later, and lets A/B tests compare policies on the same data.

### 13.3 Dependency rules (enforced, not hoped for)

```
app/ (routes, pages) ──► server/ (services, repos) ──► engine/ (pure)
                                   │
                                   ├──► connectors/<id>/   (may import connectors/types, engine types only)
                                   └──► packs/<id>/        (may import packs/types, engine types only)
```

- ESLint boundary rules (`eslint-plugin-boundaries` or `no-restricted-imports`) enforce these rules, and CI fails on violations:
  - `engine/` imports nothing from server, connectors or packs.
  - Connectors never import each other or packs.
  - Packs never import connectors.
  - Only `server/` composes them.
- No `if (connectorId === "…")` or `if (pack === "…")` outside the registries. A lint rule flags string comparisons against registry IDs in `server/` and `engine/`.

### 13.4 Safe change mechanics

- **Per-workspace feature flags** (`Workspace.settings.flags`, or the Vercel Flags SDK): new connectors, policies and modes roll out to one workspace first, starting with an internal demo workspace, then YouVersion, then everyone.
- **Shadow mode for policies:** a new `DecisionPolicy` can run alongside the live one. It logs what it would have chosen without acting, so a new algorithm can be checked offline before it gets traffic.
- **Holdout and policy splits:** agents can split traffic across policies, which turns algorithm changes into measurable experiments.
- **Vendor API drift:** each connector pins the vendor API version it targets and records fixtures. The nightly sandbox smoke tests (§10) catch drift before customers do.
- **Small files:** adapters, policies and pack modules stay focused, ideally under about 300 lines each. The 2,100-line `select-and-send` gets split into `enroll`, `eligibility`, `select`, `schedule` and `activate` stages behind a `Pipeline` of composable steps. A new gate (say, a new suppression rule) is then one step inserted in the pipeline, not an edit to a giant function.

### 13.5 Contract tests guard the seams

- Every port has a shared contract suite: conformance kit for connectors, a policy contract suite (convergence on a synthetic bandit and deterministic output under a seed), and a pack contract suite (extractors return 0..1 and handle missing fields).
- Any new implementation must pass its port's suite before it's registered, so swapping an implementation is safe by construction.

## 14. Open items for phase plans

- Queue choice: Vercel Queues (beta) or Vercel Workflow. Decide in the P2 plan after a short spike on delayed delivery and per-key ordering.
- Cache backend for the Decision API: Redis from the Marketplace, or in-process only. Decide in P4.
- Whether Nexus seeds YouVersion's `ProviderBinding` rows from env or from `scripts/sync-braze-canvas-ids.ts`. Decide in P1.
