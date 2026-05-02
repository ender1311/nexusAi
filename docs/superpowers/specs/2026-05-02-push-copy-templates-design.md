# Push Copy Templates Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire a template-backed copy library into the agent creation flow so every push notification's title, body, and deeplink always comes from a DB row — never hardcoded — and template updates automatically propagate to all cloned variants.

**Architecture:** A `__push-copy-library__` seed agent holds canonical `MessageVariant` rows tagged by category. The wizard clones selected templates into the new agent's own rows via `sourceTemplateId`. An inline sync (PATCH variant route) plus a nightly reconciliation cron keep clones in sync with their source templates. `decideForUser` threads `deeplink` through to callers so the cron and decide API deliver it to Braze without any hardcoded strings.

**Tech Stack:** Next.js App Router, Prisma v7 + Neon PostgreSQL, Bun test runner, existing `PayloadFactory`, `decideForUser`, agent wizard.

---

## Data Model

### `MessageVariant` — two new fields (migration)

```sql
ALTER TABLE "MessageVariant" ADD COLUMN "category"         TEXT;
ALTER TABLE "MessageVariant" ADD COLUMN "sourceTemplateId" TEXT
  REFERENCES "MessageVariant"("id") ON DELETE SET NULL;
```

**`category`** — destination category for wizard filtering. Values:
- `"bible-verse"` — links to a specific scripture passage
- `"guided-scripture"` — `bible.com/stories` (Today's Guided Scripture)
- `"plans"` — reading plans discovery or user's active plans
- `"general"` — native reader re-engagement, no specific destination

Nullable. Existing variants default to null. Template variants always have a category.

**`sourceTemplateId`** — set on clone creation; points to the `MessageVariant` in `__push-copy-library__` it was copied from. Null for hand-authored variants and for the templates themselves. `ON DELETE SET NULL` so deleting a template orphans clones gracefully rather than cascading.

---

## Template Library

### Seed agent: `__push-copy-library__`

A dedicated agent created by `scripts/seed-push-copy-templates.ts`. Never used for decisions (`status: "draft"`). Holds one `Message` per category, each with 2–4 `MessageVariant` rows seeded from `docs/push-copy-inventory.md`.

**Seed variants (sourced from approved inventory):**

| Category | Name | Title | Body | Deeplink |
|---|---|---|---|---|
| bible-verse | A — Consistency | "Growth is not about perfection…" | "It's about consistency ➡️" | `youversion://bible` |
| bible-verse | B — VOTD | "👂 Listen to God today" | "Reflect on the Verse of the Day ➡️" | `youversion://bible?reference=JHN.3.16` |
| bible-verse | D — Personalized | `{{${first_name} \| default: "friend"}}, what's your next step?` | "Spend time with Him in the Bible App today." | `youversion://bible?reference=PSA.23.1` |
| guided-scripture | C — Pause | "⏸️ Pause with God" | "Take a moment with Him today…" | `https://www.bible.com/stories` |
| guided-scripture | C — Prayer | "Have a minute?" | "Spend time with God in Guided Prayer." | `https://www.bible.com/guides/1` |
| plans | Lapsing Plans | "Congrats! You completed a Plan!" | "Choose another Plan and keep your momentum going." | `https://www.bible.com/reading-plans` |
| plans | Resume | "Who do you want to be?" | "Here's what happens when you spend time with God ➡️" | `https://www.bible.com/my-plans` |
| general | A2 — Habit | "Growth is not about perfection…" | "It's about consistency ➡️" | `youversion://bible` |
| general | D2 — Next Step | `{{${first_name} \| default: "friend"}}, what's your next step?` | "Open your Bible App today!" | `youversion://bible` |

All seed variants have `status: "active"` and appropriate `actionFeatures` (tone, hasPersonalization, ctaType, messageLengthBucket).

### Clone fields

When the wizard clones a template, it copies: `title`, `body`, `deeplink`, `cta`, `category`, `actionFeatures`. Sets `sourceTemplateId` to the template's id. Agent-specific fields (`brazeVariantId`, `warmupUntil`, `status`, `name`, `preferredHour`, `frequencyCapOverride`) are set by the operator or left at defaults.

---

## Decide Flow — `deeplink` Threading

### `DecideResult` (updated)

```ts
export type DecideResult =
  | { suppressed: true; reason: "quiet_hours" | "frequency_cap" | "smart_suppression" }
  | {
      suppressed: false;
      brazeVariantId: string | null;
      deeplink: string | null;          // ← new
      messageVariantId: string;
      channel: string;
      userDecisionId: string;
      recommendedSendHour: number | null;
    };
```

`decideForUser` already fetches the variant row; `selected.deeplink` is read directly from it.

### Cron route (`select-and-send`)

The variant group shape gains `deeplink: string | null`. The `buildPushPayload` call becomes:

```ts
factory.buildPushPayload(
  { title: group.title ?? "", body: group.body, deeplink: group.deeplink ?? undefined },
  audience,
  group.brazeCampaignId ?? undefined,
  sendId ?? undefined,
  group.brazeVariantId ?? undefined,
)
```

No other changes to the cron route.

---

## Wizard Flow

### `/api/variants` — category filter

`GET /api/variants?category=bible-verse` returns only variants with `category = "bible-verse"`. No `category` param returns all active variants (backward-compatible).

### Step 3 UI change

Before the `PushVariantPicker` renders, a destination picker appears:

```
[ Bible Verse ]  [ Guided Scripture ]  [ Plans ]  [ General ]
```

Selecting a category sets `selectedCategory` in component state and passes `?category=selectedCategory` to the `PushVariantPicker` fetch. The variant list rerenders filtered to that category.

Operator selects 2–5 variants. On next, the wizard records which template variant IDs were selected (not copies yet — cloning happens on final save).

### Save (clone on submit)

When the wizard POSTs to create the agent, the save handler:
1. Creates the `Agent` row
2. Creates one `Message` row per channel under that agent
3. For each selected template variant, creates a new `MessageVariant` row cloning the copy fields and setting `sourceTemplateId`
4. Wraps steps 1–3 in a single Prisma transaction

---

## Template Sync

### Inline sync — `PATCH /api/variants/[id]`

When a variant update request arrives and the target variant belongs to `__push-copy-library__` (its `message.agent.name === "__push-copy-library__"`):

1. Apply the update to the template row
2. Find all `MessageVariant` rows where `sourceTemplateId = id`
3. Update each clone's copy fields (`title`, `body`, `deeplink`, `cta`, `category`, `actionFeatures`) to match the template
4. Never touch: `brazeVariantId`, `warmupUntil`, `status`, `name`, `preferredHour`, `preferredDayOfWeek`, `frequencyCapOverride`, `messageId`, `sourceTemplateId`

All in one Prisma transaction. Returns `{ updated: N }` alongside the template row.

### Reconciliation cron — `GET /api/cron/sync-template-variants`

Runs nightly. For every active template variant (where `message.agent.name === "__push-copy-library__"`):

1. Fetch all clones where `sourceTemplateId = template.id`
2. For each clone, compare copy fields to template
3. If any differ, update the clone
4. Return `{ templatesChecked, clonesUpdated }`

Authenticated with `CRON_SECRET` bearer token (same pattern as other cron routes).

---

## Tests

### Unit

- `decideForUser` returns `deeplink` equal to the DB variant's `deeplink` field
- `decideForUser` returns `deeplink: null` when variant has no deeplink
- Cron group builder includes `deeplink` from variant row
- Sync helper updates only copy fields; non-copy fields are unchanged

### Integration

- `POST /api/decide` — response `data.deeplink` matches the seeded variant's `deeplink`
- `GET /api/variants?category=bible-verse` — returns only `category="bible-verse"` variants
- `GET /api/variants` (no param) — returns all active variants regardless of category
- `PATCH /api/variants/[id]` on a template — all clones receive updated copy fields; their `brazeVariantId` and `status` are unchanged
- `GET /api/cron/sync-template-variants` — corrects a manually drifted clone (direct DB edit simulation)
- Wizard save — creates agent + message + cloned variants with correct `sourceTemplateId`, `deeplink`, `title`, `body`

### Seed verification

- Seed script creates exactly 9 template variants across 4 categories
- All template variants have non-null `deeplink`
- All template variants have `sourceTemplateId = null`
- Seed is idempotent (running twice doesn't duplicate rows)

---

## Files Created or Modified

| Action | Path | Purpose |
|---|---|---|
| Create | `prisma/migrations/…_add_variant_category_and_source/migration.sql` | `category` + `sourceTemplateId` columns |
| Create | `scripts/seed-push-copy-templates.ts` | Seed `__push-copy-library__` agent + 9 variants |
| Modify | `src/lib/decide.ts` | Add `deeplink` to `DecideResult`, read from `selected.deeplink` |
| Modify | `src/app/api/cron/select-and-send/route.ts` | Pass `deeplink` through to `buildPushPayload` |
| Modify | `src/app/api/variants/route.ts` | Add `?category=` filter + include `category` in response |
| Create | `src/app/api/variants/[id]/route.ts` | `PATCH` handler with inline template sync |
| Create | `src/app/api/cron/sync-template-variants/route.ts` | Nightly reconciliation cron |
| Modify | `src/components/agents/agent-wizard.tsx` | Destination picker + clone-on-save logic |
| Modify | `src/components/agents/push-variant-picker.tsx` | Accept `category` prop, pass to fetch |
| Modify | `tests/helpers/builders.ts` | Add `category`, `sourceTemplateId` to `createVariant` |
| Create | `tests/unit/decide-deeplink.test.ts` | Unit tests for deeplink threading |
| Create | `tests/unit/template-sync.test.ts` | Unit tests for sync field rules |
| Create | `tests/integration/variants.test.ts` | Integration tests for `/api/variants` |
| Create | `tests/integration/template-sync.test.ts` | Integration tests for PATCH + cron sync |

---

## Out of Scope

- Operator UI to edit template variants (manage templates via seed script + PATCH API only)
- Per-variant send analytics dashboard
- Template versioning / rollback
- Operator ability to "detach" a clone from its template (set `sourceTemplateId = null`)
