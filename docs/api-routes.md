# API Routes

All REST endpoints in `src/app/api/`. This is the complete handler inventory (~56 route files).

## Response contract

Per `src/app/api/CLAUDE.md`, routes return `{ data: T }` on success or `{ error: string }`
on failure with the correct status (`200/201` success, `400` bad input, `401/403` auth,
`404` missing, `409` conflict, `500` unexpected). Prisma `P2025` → `404`, `P2002` → `409`.
Some older routes still return bare objects (`{ ok, ... }`); those are noted as exceptions.

## Authentication

| Mechanism | Helper | Applies to |
|-----------|--------|------------|
| WorkOS admin session | `requireAdmin()` (`src/lib/auth.ts`) | all mutating UI routes |
| Ingest token | `verifyIngestAuth(headers)` (`src/lib/ingest-auth.ts`) | `/api/ingest/*`, `/api/decide` |
| Cron secret | `Authorization: Bearer $CRON_SECRET` | `/api/cron/*`, `/api/admin/sync-plan-sets`, `/api/agents/:id/decide` |
| None (read-only) | — | non-sensitive GET routes (lists, stats) |

`verifyIngestAuth` accepts **either** `Authorization: Bearer <INGEST_API_KEY | HIGHTOUCH_API_KEY>`
**or** an `x-hightouch-token` header matching one of those keys.

## Endpoint inventory

### Agents
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/agents` | none | List agents with goals, messages, scheduling, decision counts |
| POST | `/api/agents` | admin | Create agent + nested goals + messages + variants |
| POST | `/api/agents/reorder` | admin | Persist drag-and-drop `sortOrder` |
| GET | `/api/agents/:id` | none | Single agent detail |
| PATCH | `/api/agents/:id` | admin | Update agent fields |
| DELETE | `/api/agents/:id` | admin | Cascade-delete agent |
| GET/POST/PUT | `/api/agents/:id/goals` | admin (writes) | List / create / bulk-replace goals |
| GET/POST/PUT | `/api/agents/:id/messages` | admin (writes) | List / create / update messages + variants |
| GET | `/api/agents/:id/metrics` | none | Last 100 `ModelMetric` snapshots |
| GET | `/api/agents/:id/arm-health` | none | Per-variant bandit arm stats / convergence health |
| GET/PUT | `/api/agents/:id/scheduling` | admin (PUT) | Read / upsert `SchedulingRule` |
| GET | `/api/agents/:id/sends` | none | Recent sends/decisions for this agent |
| POST | `/api/agents/:id/release` | admin | Manually release this agent's user ownership |
| POST | `/api/agents/:id/decide` | cron | Server-to-server decide for this agent |
| POST | `/api/agents/:id/personas` | admin | Add an `AgentPersonaTarget` |
| DELETE | `/api/agents/:id/personas/:personaId` | admin | Remove a persona target |

### Decisioning
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/decide` | ingest | Pick a variant for a user+agent (shared `selectVariant` dispatch) |

### Personas
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET/POST | `/api/personas` | admin (POST) | List active personas w/ counts / create manual persona |
| GET/PUT/DELETE | `/api/personas/:id` | admin (writes) | Read / update / soft-delete (`isActive=false`) |
| POST | `/api/personas/discover` | admin | Run discovery (HDBSCAN default) + batch-assign users |
| POST | `/api/personas/migrate` | admin | Migrate/reassign persona records |

### Ingest (Hightouch / Braze → Nexus)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/ingest/users` | ingest | Upsert `TrackedUser` profiles (nested `{ users:[{external_user_id, attributes}] }`); detects funnel recovery |
| POST | `/api/ingest/events` | ingest | Conversion events → reward + arm update (idempotent via `event_id`) |
| POST | `/api/ingest/braze-events` | ingest | **Primary reward path** — Braze Currents (click → reward) |
| POST | `/api/ingest/audiences` | ingest | Audience membership → `TrackedUser.funnelStage` |
| POST | `/api/ingest/segments` | ingest | Segment membership → `UserSegment` rows |
| POST | `/api/data-ingest/push-event` | ingest/admin | Push open events (legacy ingest path) |

### Cron (Vercel scheduled; `Authorization: Bearer $CRON_SECRET`)
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/cron/select-and-send` | **Hourly** (`0 * * * *`) send pipeline — see `docs/send-timing-architecture.md` |
| GET | `/api/cron/runs` | List recent `CronRun` rows (Control Tower) — read-only |
| GET/POST | `/api/cron/discover-personas` | Scheduled persona discovery |
| GET/POST | `/api/cron/ingest-braze-analytics` | 48-hour DB-based reward decay sweep |
| GET | `/api/cron/sync-template-variants` | Sync template variants to per-agent clones |

### Content, variants, library
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/variants` | none | List variants (variant picker) |
| PATCH/DELETE | `/api/variants/:id` | admin | Update / delete a variant |
| GET/POST | `/api/campaign-content` | admin (POST) | Per-language scripture campaign content |
| PATCH/DELETE | `/api/campaign-content/:id` | admin | Update / delete content |
| GET/POST | `/api/push-library` | admin (POST) | Reusable push-copy library |
| DELETE | `/api/push-library/:id` | admin | Delete a library entry |
| POST | `/api/push-translations/import` | admin | Bulk-import `MessageVariantTranslation` rows |

### Hightouch passthrough (admin dashboard)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/hightouch/syncs` | none | List syncs |
| GET | `/api/hightouch/syncs/:id/runs` | none | Sync run history |
| POST | `/api/hightouch/syncs/:id/trigger` | admin | Trigger a sync run |
| GET | `/api/hightouch/sources` / `/models` / `/destinations` | none | Catalog passthrough |

### Demo (Live Send Demo)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/demo/arm-stats` | none | Per-arm Beta stats for the demo panel |
| GET/POST | `/api/demo/groups` | none | List / create test-user groups (`DemoUserGroup`) |
| DELETE | `/api/demo/groups/:id` | none | Delete a group |
| POST | `/api/demo/preview` | none | Preview the decision for a test user |
| POST | `/api/demo/send` | admin | Fire a real send to test users |

### Settings, prefs, misc
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET/POST | `/api/settings` | admin (POST) | Key-value app settings (Braze config, etc.) |
| GET/PUT | `/api/preferences/stat-visibility` | session | Per-user hidden-stat preferences |
| GET | `/api/stats` | none | Fleet-wide summary stats |
| GET | `/api/segments` | none | Distinct segment names (for targeting UI) |
| GET | `/api/metrics/push-summary` | none | Push send/open/conversion summary |
| GET | `/api/users/:externalId` | none | Single tracked-user detail |
| GET/POST/DELETE | `/api/test-users` | admin (writes) | Manage demo/test users |
| POST | `/api/admin/sync-plan-sets` | cron | Sync YouVersion plan-sets → `PlanSet`/`PlanSetMember` |
| POST | `/api/revalidate` | — | Trigger ISR `revalidateTag` |

## Key request / response shapes

### POST /api/agents
```typescript
// Request
{
  name: string
  description?: string
  algorithm?: "thompson" | "epsilon_greedy" | "linucb"
  epsilon?: number
  funnelStage?: string
  segmentTargeting?: { includes: string[]; excludes: string[] }
  goals?: Array<{
    eventName: string
    tier: "best" | "very_good" | "good" | "bad" | "very_bad" | "worst"
    valueWeight?: number
    weightMode?: "fixed" | "property"
    weightProperty?: string
    weightDefault?: number
    description?: string
  }>
  messages?: Array<{
    name: string
    channel: "push" | "email" | "in-app" | "content-card"
    brazeCampaignId?: string
    testedVariables?: string[]
    variants?: Array<{ name: string; subject?: string; body?: string; cta?: string; title?: string; deeplink?: string }>
  }>
}
// Response: { data: Agent with nested goals, messages, schedulingRule }
```

### PATCH /api/agents/:id
```typescript
// All fields optional — send only what changes
{
  name?, description?, status?: "draft" | "active" | "paused",
  algorithm?: "thompson" | "epsilon_greedy" | "linucb", epsilon?,
  funnelStage?, targetSegmentName?, segmentTargeting?: { includes, excludes } | null,
  audienceCap?, uniqueUsersCap?, dailySendCap?, languageFilter?, localizePush?,
  staleFunnelStageDays?, color?, sortOrder?, fallbackSendHour?, holdMaxDays?, holdMaxSends?
}
// 409 if segmentTargeting includes/excludes overlap or duplicate an existing agent's target.
```

### POST /api/ingest/events
```typescript
// Auth: verifyIngestAuth (Bearer key or x-hightouch-token)
{ events: Array<{ event_id: string; event_name: string; external_user_id: string; occurred_at: string /* ISO 8601 */; properties?: Record<string, unknown> }> }
// Response (bare, legacy): { ok, received, deduplicated, matched, unmatched } — idempotent on event_id
```

### POST /api/ingest/users
```typescript
// Auth: verifyIngestAuth. Nested format stores attributes verbatim.
{ users: Array<{ external_user_id: string; braze_id?: string; attributes?: Record<string, unknown> }> }
// Response (bare, legacy): { ok, received, deduplicated, skipped_anonymous, upserted, persona_assigned }
```

### POST /api/personas/discover
```typescript
{ minInteractions?: number /* 20 */; minK?: number /* 3 */; maxK?: number /* 15 */; algorithm?: "hdbscan" | "kmeans" }
// Response (bare, legacy): { ok, personasCreated, personasUpdated, usersAssigned, silhouetteScore, k }
```

### GET /api/settings
```typescript
// Response: { data: { BRAZE_API_KEY, BRAZE_REST_ENDPOINT, BRAZE_NEXUS_CAMPAIGN_ID, BRAZE_NEXUS_IOS_VARIANT_ID, ... } }
```
