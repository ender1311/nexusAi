# Push Copy Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a template-backed copy library into the agent creation flow so every push notification's title, body, and deeplink always comes from a DB row — never hardcoded — and template updates automatically propagate to all cloned variants.

**Architecture:** A `__push-copy-library__` seed agent holds canonical `MessageVariant` rows tagged by category. The wizard clones selected templates into the new agent's rows via `sourceTemplateId`. Inline PATCH sync + nightly reconciliation cron keep clones current. `decideForUser` returns `deeplink` so the cron and decide API deliver it to Braze.

**Tech Stack:** Next.js 15 App Router, Prisma v7 + Neon PostgreSQL, Bun test runner, React 19, Tailwind CSS v4, existing `PayloadFactory`, `decideForUser`.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `prisma/migrations/20260502000000_add_variant_category_and_source/migration.sql` | Add `category` + `sourceTemplateId` columns |
| Modify | `prisma/schema.prisma` | Add fields to `MessageVariant` model |
| Modify | `tests/helpers/builders.ts` | Add `category`, `sourceTemplateId` to `createVariant` |
| Create | `scripts/seed-push-copy-templates.ts` | Seed `__push-copy-library__` agent + 9 variants |
| Modify | `src/lib/decide.ts` | Add `deeplink` to `DecideResult`, return from `selected.deeplink` |
| Modify | `src/app/api/cron/select-and-send/route.ts` | Add `deeplink` to `VariantSendGroup`, pass to `buildPushPayload` |
| Create | `src/lib/engine/template-sync.ts` | Pure sync helpers: `TEMPLATE_COPY_FIELDS`, `syncClonesFromTemplate` |
| Modify | `src/app/api/variants/route.ts` | Add `?category=` filter, include `category`+`sourceTemplateId` in response |
| Create | `src/app/api/variants/[id]/route.ts` | `PATCH` handler — update variant, inline-sync clones if template |
| Create | `src/app/api/cron/sync-template-variants/route.ts` | Nightly reconciliation cron |
| Modify | `src/app/api/agents/route.ts` | Accept `sourceTemplateId` in variant create payload |
| Modify | `src/components/agents/push-variant-picker.tsx` | Accept `category?` prop, re-fetch on change |
| Modify | `src/components/agents/agent-wizard.tsx` | Destination picker, pass `category`, include `sourceTemplateId` in clone |
| Create | `tests/integration/variants.test.ts` | `GET /api/variants` category filter + content tests |
| Create | `tests/integration/template-sync.test.ts` | PATCH inline sync + cron reconciliation tests |
| Modify | `tests/integration/decide.test.ts` | Two new tests: `deeplink` in result, `deeplink: null` fallback |
| Modify | `tests/integration/agents.test.ts` | One new test: agent create with `sourceTemplateId` on variant |

---

## Task 1: Migration — `category` + `sourceTemplateId`

**Files:**
- Create: `prisma/migrations/20260502000000_add_variant_category_and_source/migration.sql`
- Modify: `prisma/schema.prisma:66-90`
- Modify: `tests/helpers/builders.ts:55-75`

- [ ] **Step 1: Write the migration SQL**

Create file `prisma/migrations/20260502000000_add_variant_category_and_source/migration.sql`:

```sql
-- Add destination category for wizard filtering
-- Values: 'bible-verse' | 'guided-scripture' | 'plans' | 'general'
ALTER TABLE "MessageVariant" ADD COLUMN "category" TEXT;

-- Track clone → template relationship for sync
-- ON DELETE SET NULL: deleting a template orphans clones gracefully
ALTER TABLE "MessageVariant" ADD COLUMN "sourceTemplateId" TEXT
  REFERENCES "MessageVariant"("id") ON DELETE SET NULL;
```

- [ ] **Step 2: Update `prisma/schema.prisma`**

Add the two fields to `model MessageVariant` after `warmupUntil`:

```prisma
  warmupUntil          DateTime?
  category             String?
  sourceTemplateId     String?
  // Semantic descriptor of the message — enables oracle generalization across variants
```

- [ ] **Step 3: Apply migration to test DB and generate client**

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: `1 migration applied`, no errors. Then:

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Update `createVariant` builder**

In `tests/helpers/builders.ts`, update `createVariant`:

```ts
export async function createVariant(
  messageId: string,
  overrides: {
    name?: string;
    body?: string;
    title?: string | null;
    brazeVariantId?: string | null;
    status?: string;
    deeplink?: string | null;
    category?: string | null;
    sourceTemplateId?: string | null;
  } = {}
) {
  return prisma.messageVariant.create({
    data: {
      messageId,
      name: "Variant A",
      body: "Test body",
      title: "Test title",
      status: "active",
      ...overrides,
    },
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/20260502000000_add_variant_category_and_source/migration.sql \
        prisma/schema.prisma \
        src/generated/prisma \
        tests/helpers/builders.ts
git commit -m "feat: add category and sourceTemplateId to MessageVariant"
```

---

## Task 2: Seed Push Copy Templates

**Files:**
- Create: `scripts/seed-push-copy-templates.ts`

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-push-copy-templates.ts`:

```ts
/**
 * Seed script: Push Copy Template Library
 *
 * Creates a __push-copy-library__ agent with 9 approved MessageVariant rows
 * across 4 destination categories. These are the canonical templates operators
 * select when creating agents in the wizard. They are cloned (not referenced)
 * into each agent's own variants via sourceTemplateId.
 *
 * Copy sourced from: docs/push-copy-inventory.md
 * Deep-links sourced from: docs/deeplinks.md
 *
 * Usage: bun run scripts/seed-push-copy-templates.ts
 * Idempotent: safe to run multiple times.
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { prisma } from "../src/lib/db";

const LIBRARY_AGENT_NAME = "__push-copy-library__";

const TEMPLATES: Array<{
  category: string;
  messageName: string;
  name: string;
  title: string;
  body: string;
  deeplink: string;
  cta: string;
  actionFeatures: object;
}> = [
  // ── Bible Verse ────────────────────────────────────────────────────────
  {
    category: "bible-verse",
    messageName: "Bible Verse Templates",
    name: "A — Consistency",
    title: "Growth is not about perfection…",
    body: "It's about consistency ➡️",
    deeplink: "youversion://bible",
    cta: "Open Bible App",
    actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  {
    category: "bible-verse",
    messageName: "Bible Verse Templates",
    name: "B — VOTD",
    title: "👂 Listen to God today",
    body: "Reflect on the Verse of the Day ➡️",
    deeplink: "youversion://bible?reference=JHN.3.16",
    cta: "Read John 3:16",
    actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  {
    category: "bible-verse",
    messageName: "Bible Verse Templates",
    name: "D — Personalized",
    title: "{{${first_name} | default: \"friend\"}}, what's your next step?",
    body: "Spend time with Him in the Bible App today.",
    deeplink: "youversion://bible?reference=PSA.23.1",
    cta: "Read Psalm 23",
    actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  // ── Guided Scripture ──────────────────────────────────────────────────
  {
    category: "guided-scripture",
    messageName: "Guided Scripture Templates",
    name: "C — Pause",
    title: "⏸️ Pause with God",
    body: "Take a moment with Him today…",
    deeplink: "https://www.bible.com/stories",
    cta: "Open Guided Scripture",
    actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  {
    category: "guided-scripture",
    messageName: "Guided Scripture Templates",
    name: "C — Prayer",
    title: "Have a minute?",
    body: "Spend time with God in Guided Prayer.",
    deeplink: "https://www.bible.com/guides/1",
    cta: "Open Guided Prayer",
    actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  // ── Plans ─────────────────────────────────────────────────────────────
  {
    category: "plans",
    messageName: "Plans Templates",
    name: "Lapsing Plans",
    title: "Congrats! You completed a Plan!",
    body: "Choose another Plan and keep your momentum going.",
    deeplink: "https://www.bible.com/reading-plans",
    cta: "Find a Plan",
    actionFeatures: { tone: "milestone", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "medium" },
  },
  {
    category: "plans",
    messageName: "Plans Templates",
    name: "Resume",
    title: "Who do you want to be?",
    body: "Here's what happens when you spend time with God ➡️",
    deeplink: "https://www.bible.com/my-plans",
    cta: "Continue My Plans",
    actionFeatures: { tone: "question", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  // ── General ───────────────────────────────────────────────────────────
  {
    category: "general",
    messageName: "General Re-engagement Templates",
    name: "A2 — Habit",
    title: "Growth is not about perfection…",
    body: "It's about consistency ➡️",
    deeplink: "youversion://bible",
    cta: "Open Bible App",
    actionFeatures: { tone: "empathy", hasPersonalization: false, ctaType: "deeplink", messageLengthBucket: "short" },
  },
  {
    category: "general",
    messageName: "General Re-engagement Templates",
    name: "D2 — Next Step",
    title: "{{${first_name} | default: \"friend\"}}, what's your next step?",
    body: "Open your Bible App today!",
    deeplink: "youversion://bible",
    cta: "Open Bible App",
    actionFeatures: { tone: "question", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short" },
  },
];

async function main() {
  console.log("🌱 Seeding push copy template library...\n");

  // Find or create the library agent
  let agent = await prisma.agent.findFirst({ where: { name: LIBRARY_AGENT_NAME } });
  if (agent) {
    console.log(`  ✓ Library agent already exists (${agent.id})`);
  } else {
    agent = await prisma.agent.create({
      data: {
        name: LIBRARY_AGENT_NAME,
        description: "Canonical push copy templates. Never used for decisions — status stays draft.",
        algorithm: "thompson",
        epsilon: 0.1,
        status: "draft",
        funnelStage: "connected",
      },
    });
    console.log(`  + Created library agent (${agent.id})`);
  }

  // Group templates by messageName and upsert
  const byMessage = new Map<string, typeof TEMPLATES>();
  for (const t of TEMPLATES) {
    const list = byMessage.get(t.messageName) ?? [];
    list.push(t);
    byMessage.set(t.messageName, list);
  }

  let totalVariants = 0;
  for (const [msgName, variants] of byMessage) {
    let message = await prisma.message.findFirst({
      where: { agentId: agent.id, name: msgName },
    });
    if (!message) {
      message = await prisma.message.create({
        data: { agentId: agent.id, name: msgName, channel: "push" },
      });
      console.log(`  + Created message "${msgName}" (${message.id})`);
    } else {
      console.log(`  ✓ Message "${msgName}" already exists (${message.id})`);
    }

    for (const t of variants) {
      const existing = await prisma.messageVariant.findFirst({
        where: { messageId: message.id, name: t.name },
      });
      if (existing) {
        console.log(`    ✓ Variant "${t.name}" already exists`);
      } else {
        await prisma.messageVariant.create({
          data: {
            messageId: message.id,
            name: t.name,
            title: t.title,
            body: t.body,
            deeplink: t.deeplink,
            cta: t.cta,
            category: t.category,
            status: "active",
            actionFeatures: t.actionFeatures,
          },
        });
        console.log(`    + Created variant "${t.name}" (${t.category})`);
        totalVariants++;
      }
    }
  }

  console.log(`\n✅ Done — ${totalVariants} new variants seeded.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 2: Run the seed script**

```bash
bun run scripts/seed-push-copy-templates.ts
```

Expected output:
```
🌱 Seeding push copy template library...
  + Created library agent (...)
  + Created message "Bible Verse Templates" (...)
    + Created variant "A — Consistency" (bible-verse)
    + Created variant "B — VOTD" (bible-verse)
    + Created variant "D — Personalized" (bible-verse)
  ...
✅ Done — 9 new variants seeded.
```

- [ ] **Step 3: Run seed again to verify idempotency**

```bash
bun run scripts/seed-push-copy-templates.ts
```

Expected: all lines show `✓` (already exists), `0 new variants seeded`.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-push-copy-templates.ts
git commit -m "feat: add push copy template seed script (9 variants, 4 categories)"
```

---

## Task 3: Thread `deeplink` Through `decideForUser`

**Files:**
- Modify: `src/lib/decide.ts:50-61` (DecideResult type), `src/lib/decide.ts:285-293` (return statement)
- Modify: `tests/integration/decide.test.ts`

- [ ] **Step 1: Write two failing tests in `tests/integration/decide.test.ts`**

Add after the last `it(...)` block in the `describe("POST /api/decide")` block:

```ts
  it("returns deeplink from the selected variant in DecideResult", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ algorithm: "thompson" });
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, {
      name: "A",
      deeplink: "youversion://bible?reference=JHN.3.16",
    });
    await createUser("usr_deeplink", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_deeplink" }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.deeplink).toBe("youversion://bible?reference=JHN.3.16");
  });

  it("returns deeplink: null when variant has no deeplink set", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ algorithm: "thompson" });
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "A" }); // no deeplink
    await createUser("usr_nodeeplink", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_nodeeplink" }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.deeplink).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test --max-concurrency=1 --timeout 30000 tests/integration/decide.test.ts 2>&1 | grep -E "pass|fail"
```

Expected: `9 pass, 2 fail` (the new tests fail because `deeplink` isn't in the response yet).

- [ ] **Step 3: Update `DecideResult` type in `src/lib/decide.ts`**

Replace the `suppressed: false` branch of `DecideResult`:

```ts
export type DecideResult =
  | { suppressed: true; reason: "quiet_hours" | "frequency_cap" | "smart_suppression" }
  | {
      suppressed: false;
      brazeVariantId: string | null;
      deeplink: string | null;
      messageVariantId: string;
      channel: string;
      userDecisionId: string;
      /** Best send hour (0-23) derived from user's hourlyStats app-usage curve; null if no data */
      recommendedSendHour: number | null;
    };
```

- [ ] **Step 4: Return `deeplink` in `decideForUser`**

In `src/lib/decide.ts`, update the final return statement (currently around line 285):

```ts
  return {
    suppressed: false,
    brazeVariantId: selected.brazeVariantId ?? null,
    deeplink: selected.deeplink ?? null,
    messageVariantId: selected.id,
    channel: selected.channel,
    userDecisionId: decision.id,
    recommendedSendHour,
  };
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test --max-concurrency=1 --timeout 30000 tests/integration/decide.test.ts 2>&1 | grep -E "pass|fail"
```

Expected: `11 pass, 0 fail`.

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/decide.ts tests/integration/decide.test.ts
git commit -m "feat: add deeplink to DecideResult — threaded from variant row"
```

---

## Task 4: Thread `deeplink` Through Cron Route

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts:18-27` (VariantSendGroup type), `~62-79` (variantMeta map), `~232-245` (byVariant group build), `~264-270` (buildPushPayload call)

- [ ] **Step 1: Add `deeplink` to `VariantSendGroup` type**

In `src/app/api/cron/select-and-send/route.ts`, update the `VariantSendGroup` type:

```ts
type VariantSendGroup = {
  variantId: string;
  brazeVariantId: string | null;
  brazeCampaignId: string | null;
  channel: string;
  body: string;
  title: string | null;
  deeplink: string | null;
  externalUserIds: string[];
  decisionIds: string[];
};
```

- [ ] **Step 2: Include `deeplink` in `variantMeta` map**

Update the `variantMeta` map type and population (around line 62):

```ts
    const variantMeta = new Map<string, {
      channel: string;
      body: string;
      title: string | null;
      deeplink: string | null;
      brazeCampaignId: string | null;
      brazeVariantId: string | null;
    }>();
    for (const msg of agent.messages) {
      for (const v of msg.variants) {
        variantMeta.set(v.id, {
          channel:         msg.channel,
          body:            v.body,
          title:           v.title ?? null,
          deeplink:        v.deeplink ?? null,
          brazeCampaignId: msg.brazeCampaignId ?? null,
          brazeVariantId:  v.brazeVariantId ?? null,
        });
      }
    }
```

- [ ] **Step 3: Include `deeplink` when building the `byVariant` group**

Update the group initializer (around line 231):

```ts
          if (!byVariant[messageVariantId]) {
            byVariant[messageVariantId] = {
              variantId:       messageVariantId,
              brazeVariantId:  meta.brazeVariantId,
              brazeCampaignId: meta.brazeCampaignId,
              channel:         meta.channel,
              body:            meta.body,
              title:           meta.title,
              deeplink:        meta.deeplink,
              externalUserIds: [],
              decisionIds:     [],
            };
          }
```

- [ ] **Step 4: Pass `deeplink` to `buildPushPayload`**

Update the push payload construction (around line 264):

```ts
            if (group.channel === "push") {
              payload = factory.buildPushPayload(
                { title: group.title ?? "", body: group.body, deeplink: group.deeplink ?? undefined },
                audience,
                group.brazeCampaignId ?? undefined,
                sendId ?? undefined,
                group.brazeVariantId ?? undefined,
              );
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts
git commit -m "feat: thread deeplink from variant through cron send to Braze payload"
```

---

## Task 5: `GET /api/variants?category=` Filter

**Files:**
- Modify: `src/app/api/variants/route.ts`
- Create: `tests/integration/variants.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `tests/integration/variants.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { GET } from "@/app/api/variants/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/variants", () => {
  it("returns all active variants when no category param", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "V1", category: "bible-verse" });
    await createVariant(msg.id, { name: "V2", category: "plans" });

    const req = new Request("http://localhost/api/variants") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
  });

  it("filters variants by category", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "V1", category: "bible-verse" });
    await createVariant(msg.id, { name: "V2", category: "plans" });
    await createVariant(msg.id, { name: "V3", category: "bible-verse" });

    const req = new Request("http://localhost/api/variants?category=bible-verse") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body.every((v: { category: string }) => v.category === "bible-verse")).toBe(true);
  });

  it("returns category and sourceTemplateId in response", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const template = await createVariant(msg.id, { name: "Tmpl", category: "general" });
    await createVariant(msg.id, {
      name: "Clone",
      category: "general",
      sourceTemplateId: template.id,
    });

    const req = new Request("http://localhost/api/variants") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    const clone = body.find((v: { name: string }) => v.name === "Clone");
    expect(clone.category).toBe("general");
    expect(clone.sourceTemplateId).toBe(template.id);
  });

  it("excludes inactive variants", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "Active", status: "active" });
    await createVariant(msg.id, { name: "Inactive", status: "archived" });

    const req = new Request("http://localhost/api/variants") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Active");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test --max-concurrency=1 --timeout 30000 tests/integration/variants.test.ts 2>&1 | grep -E "pass|fail"
```

Expected: `0 pass, 4 fail` (category field and filter don't exist yet).

- [ ] **Step 3: Update `src/app/api/variants/route.ts`**

Replace the entire file:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const category = req.nextUrl.searchParams.get("category");
    const variants = await prisma.messageVariant.findMany({
      where: {
        status: "active",
        ...(category ? { category } : {}),
      },
      select: {
        id: true,
        name: true,
        title: true,
        body: true,
        deeplink: true,
        cta: true,
        category: true,
        sourceTemplateId: true,
        message: { select: { channel: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(variants);
  } catch (error) {
    console.error("GET /api/variants error:", error);
    return NextResponse.json({ error: "Failed to fetch variants" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test --max-concurrency=1 --timeout 30000 tests/integration/variants.test.ts 2>&1 | grep -E "pass|fail"
```

Expected: `4 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/variants/route.ts tests/integration/variants.test.ts
git commit -m "feat: add category filter and sourceTemplateId to GET /api/variants"
```

---

## Task 6: `PATCH /api/variants/[id]` with Inline Template Sync

**Files:**
- Create: `src/lib/engine/template-sync.ts`
- Create: `src/app/api/variants/[id]/route.ts`
- Create: `tests/integration/template-sync.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/integration/template-sync.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { PATCH } from "@/app/api/variants/[id]/route";
import { buildRequest } from "../helpers/request";

const LIBRARY_AGENT_NAME = "__push-copy-library__";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("PATCH /api/variants/[id]", () => {
  it("returns 404 for unknown variant", async () => {
    const req = buildRequest("PATCH", { title: "new" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("updates a regular variant without touching any clones", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id, { name: "V1", title: "old title" });
    // Create another variant with sourceTemplateId pointing to this one
    // (won't sync because variant is not in library agent)
    const clone = await createVariant(msg.id, {
      name: "Clone",
      title: "clone title",
      sourceTemplateId: variant.id,
    });

    const req = buildRequest("PATCH", { title: "new title" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: variant.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.title).toBe("new title");
    expect(body.clonesUpdated).toBe(0);

    // Clone untouched
    const cloneAfter = await prisma.messageVariant.findUnique({ where: { id: clone.id } });
    expect(cloneAfter!.title).toBe("clone title");
  });

  it("syncs copy fields to clones when template variant is updated", async () => {
    // Library agent
    const libAgent = await createAgent({ name: LIBRARY_AGENT_NAME, status: "draft" });
    const libMsg = await createMessage(libAgent.id);
    const template = await createVariant(libMsg.id, {
      name: "Tmpl",
      title: "original title",
      body: "original body",
      deeplink: "youversion://bible",
      category: "general",
    });

    // Two clones in other agents
    const agent1 = await createAgent({ name: "Agent 1" });
    const msg1 = await createMessage(agent1.id);
    const clone1 = await createVariant(msg1.id, {
      name: "C1",
      title: "original title",
      body: "original body",
      deeplink: "youversion://bible",
      category: "general",
      sourceTemplateId: template.id,
      brazeVariantId: "braze-123",     // should NOT be overwritten
      status: "active",                  // should NOT be overwritten
    });

    const agent2 = await createAgent({ name: "Agent 2" });
    const msg2 = await createMessage(agent2.id);
    const clone2 = await createVariant(msg2.id, {
      name: "C2",
      title: "original title",
      body: "original body",
      sourceTemplateId: template.id,
    });

    // Update the template
    const req = buildRequest("PATCH", {
      title: "updated title",
      body: "updated body",
      deeplink: "youversion://bible?reference=JHN.3.16",
    }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: template.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.title).toBe("updated title");
    expect(body.clonesUpdated).toBe(2);

    // Clones have updated copy fields
    const c1After = await prisma.messageVariant.findUnique({ where: { id: clone1.id } });
    expect(c1After!.title).toBe("updated title");
    expect(c1After!.body).toBe("updated body");
    expect(c1After!.deeplink).toBe("youversion://bible?reference=JHN.3.16");

    // Non-copy fields on clones are untouched
    expect(c1After!.brazeVariantId).toBe("braze-123");
    expect(c1After!.status).toBe("active");

    const c2After = await prisma.messageVariant.findUnique({ where: { id: clone2.id } });
    expect(c2After!.title).toBe("updated title");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test --max-concurrency=1 --timeout 30000 tests/integration/template-sync.test.ts 2>&1 | grep -E "pass|fail"
```

Expected: `0 pass, 3 fail`.

- [ ] **Step 3: Create `src/lib/engine/template-sync.ts`**

```ts
import { prisma } from "@/lib/db";

/** Agent name used as the copy template library container. */
export const LIBRARY_AGENT_NAME = "__push-copy-library__";

/** Fields that sync from template to clones. All other fields are clone-owned. */
export const TEMPLATE_COPY_FIELDS = [
  "title", "body", "deeplink", "cta", "category", "actionFeatures",
] as const;

/**
 * Propagates copy fields from a template variant to all its clones.
 * Looks up clones by sourceTemplateId. Runs in a single transaction.
 * Returns the number of clones updated.
 */
export async function syncClonesFromTemplate(
  templateId: string,
  copyData: Record<string, unknown>
): Promise<number> {
  const clones = await prisma.messageVariant.findMany({
    where: { sourceTemplateId: templateId },
    select: { id: true },
  });
  if (clones.length === 0) return 0;

  const syncFields = Object.fromEntries(
    TEMPLATE_COPY_FIELDS.map((f) => [f, copyData[f] ?? null])
  );

  await prisma.$transaction(
    clones.map((clone) =>
      prisma.messageVariant.update({ where: { id: clone.id }, data: syncFields })
    )
  );
  return clones.length;
}
```

- [ ] **Step 4: Create `src/app/api/variants/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIBRARY_AGENT_NAME, TEMPLATE_COPY_FIELDS, syncClonesFromTemplate } from "@/lib/engine/template-sync";

// Fields an operator is allowed to update via PATCH.
// Excludes id, messageId, sourceTemplateId, createdAt (structural / immutable).
const UPDATABLE_FIELDS = new Set([
  "name", "subject", "body", "cta", "status", "brazeVariantId", "title",
  "iconImageUrl", "deeplink", "preferredHour", "preferredDayOfWeek",
  "frequencyCapOverride", "warmupUntil", "actionFeatures", "category",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const variant = await prisma.messageVariant.findUnique({
    where: { id },
    include: { message: { include: { agent: { select: { name: true } } } } },
  });
  if (!variant) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  // Only pass whitelisted fields to the update
  const updateData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (UPDATABLE_FIELDS.has(key)) updateData[key] = value;
  }

  const updated = await prisma.messageVariant.update({
    where: { id },
    data: updateData,
  });

  // If this is a template variant, sync copy fields to all clones
  let clonesUpdated = 0;
  if (variant.message.agent.name === LIBRARY_AGENT_NAME) {
    const copyData = Object.fromEntries(
      TEMPLATE_COPY_FIELDS.map((f) => [f, (updated as Record<string, unknown>)[f]])
    );
    clonesUpdated = await syncClonesFromTemplate(id, copyData);
  }

  return NextResponse.json({ data: updated, clonesUpdated });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun test --max-concurrency=1 --timeout 30000 tests/integration/template-sync.test.ts 2>&1 | grep -E "pass|fail"
```

Expected: `3 pass, 0 fail`.

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/engine/template-sync.ts \
        src/app/api/variants/[id]/route.ts \
        tests/integration/template-sync.test.ts
git commit -m "feat: PATCH /api/variants/[id] with inline template sync to clones"
```

---

## Task 7: Nightly Reconciliation Cron

**Files:**
- Create: `src/app/api/cron/sync-template-variants/route.ts`
- Modify: `tests/integration/template-sync.test.ts` (add cron tests)

- [ ] **Step 1: Add failing cron tests to `tests/integration/template-sync.test.ts`**

Add a new `describe` block at the bottom of the file:

```ts
import { GET as syncCron } from "@/app/api/cron/sync-template-variants/route";

describe("GET /api/cron/sync-template-variants", () => {
  beforeEach(async () => {
    process.env.CRON_SECRET = "test_cron_secret";
  });
  afterEach(async () => {
    delete process.env.CRON_SECRET;
  });

  it("returns 401 without CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    const req = new Request("http://localhost/api/cron/sync-template-variants") as NextRequest;
    const res = await syncCron(req);
    expect(res.status).toBe(401);
  });

  it("corrects drifted clones and reports counts", async () => {
    const libAgent = await createAgent({ name: LIBRARY_AGENT_NAME, status: "draft" });
    const libMsg = await createMessage(libAgent.id);
    const template = await createVariant(libMsg.id, {
      name: "Tmpl",
      title: "canonical title",
      body: "canonical body",
      deeplink: "youversion://bible",
      category: "general",
    });

    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    // Clone with drifted title (simulate direct DB edit)
    const clone = await createVariant(msg.id, {
      name: "Clone",
      title: "drifted title",   // should be corrected
      body: "canonical body",
      sourceTemplateId: template.id,
    });

    const req = new Request("http://localhost/api/cron/sync-template-variants", {
      headers: { Authorization: "Bearer test_cron_secret" },
    }) as NextRequest;
    const res = await syncCron(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.templatesChecked).toBe(1);
    expect(body.clonesUpdated).toBe(1);

    const cloneAfter = await prisma.messageVariant.findUnique({ where: { id: clone.id } });
    expect(cloneAfter!.title).toBe("canonical title");
  });

  it("returns 0 clonesUpdated when no drift exists", async () => {
    const libAgent = await createAgent({ name: LIBRARY_AGENT_NAME, status: "draft" });
    const libMsg = await createMessage(libAgent.id);
    await createVariant(libMsg.id, { name: "Tmpl", category: "general" }); // no clones

    const req = new Request("http://localhost/api/cron/sync-template-variants", {
      headers: { Authorization: "Bearer test_cron_secret" },
    }) as NextRequest;
    const res = await syncCron(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.clonesUpdated).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test --max-concurrency=1 --timeout 30000 tests/integration/template-sync.test.ts 2>&1 | grep -E "pass|fail"
```

Expected: `3 pass, 3 fail`.

- [ ] **Step 3: Create `src/app/api/cron/sync-template-variants/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIBRARY_AGENT_NAME, TEMPLATE_COPY_FIELDS, syncClonesFromTemplate } from "@/lib/engine/template-sync";

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token === secret;
}

export async function GET(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templates = await prisma.messageVariant.findMany({
    where: {
      status: "active",
      message: { agent: { name: LIBRARY_AGENT_NAME } },
    },
  });

  let templatesChecked = 0;
  let clonesUpdated = 0;

  for (const template of templates) {
    templatesChecked++;
    const copyData = Object.fromEntries(
      TEMPLATE_COPY_FIELDS.map((f) => [f, (template as Record<string, unknown>)[f]])
    );
    const updated = await syncClonesFromTemplate(template.id, copyData);
    clonesUpdated += updated;
  }

  console.log(`[cron/sync-template-variants] checked=${templatesChecked} clonesUpdated=${clonesUpdated}`);
  return NextResponse.json({ ok: true, templatesChecked, clonesUpdated });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test --max-concurrency=1 --timeout 30000 tests/integration/template-sync.test.ts 2>&1 | grep -E "pass|fail"
```

Expected: `6 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/sync-template-variants/route.ts \
        tests/integration/template-sync.test.ts
git commit -m "feat: nightly template sync cron GET /api/cron/sync-template-variants"
```

---

## Task 8: `POST /api/agents` — Accept `sourceTemplateId` on Variants

**Files:**
- Modify: `src/app/api/agents/route.ts:64-99`
- Modify: `tests/integration/agents.test.ts`

- [ ] **Step 1: Write failing test**

Open `tests/integration/agents.test.ts`. Add one new test at the end of the `describe("POST /api/agents")` block:

```ts
  it("stores sourceTemplateId on variant when provided", async () => {
    const body = {
      name: "Test Agent",
      funnelStage: "connected",
      messages: [
        {
          name: "Push Message",
          channel: "push",
          variants: [
            {
              name: "V1",
              body: "Test body",
              title: "Test title",
              deeplink: "youversion://bible",
              sourceTemplateId: "tmpl_abc123",
            },
          ],
        },
      ],
    };
    const req = buildRequest("POST", body, AUTH);
    const res = await POST(req as NextRequest);
    const agent = await res.json();

    expect(res.status).toBe(201);

    const variant = await prisma.messageVariant.findFirst({
      where: { message: { agentId: agent.id } },
    });
    expect(variant).not.toBeNull();
    expect(variant!.sourceTemplateId).toBe("tmpl_abc123");
    expect(variant!.deeplink).toBe("youversion://bible");
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test --max-concurrency=1 --timeout 30000 tests/integration/agents.test.ts 2>&1 | grep -E "pass|fail"
```

Expected: existing tests pass, 1 new test fails.

- [ ] **Step 3: Update `POST /api/agents` to pass `sourceTemplateId` through**

In `src/app/api/agents/route.ts`, update the `variants` type annotation and create map:

```ts
        variants?: Array<{
          name: string;
          subject?: string;
          body: string;
          cta?: string;
          title?: string;
          iconImageUrl?: string;
          deeplink?: string;
          preferredHour?: number;
          preferredDayOfWeek?: number;
          frequencyCapOverride?: string;
          sourceTemplateId?: string;
        }>;
```

And update the `create` map:

```ts
              create: variantList.map((v) => ({
                name: v.name ?? "V1",
                subject: v.subject,
                body: v.body,
                cta: v.cta,
                title: v.title,
                iconImageUrl: v.iconImageUrl,
                deeplink: v.deeplink,
                preferredHour: v.preferredHour,
                preferredDayOfWeek: v.preferredDayOfWeek,
                frequencyCapOverride: v.frequencyCapOverride,
                sourceTemplateId: v.sourceTemplateId,
              })),
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test --max-concurrency=1 --timeout 30000 tests/integration/agents.test.ts 2>&1 | grep -E "pass|fail"
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agents/route.ts tests/integration/agents.test.ts
git commit -m "feat: accept sourceTemplateId on variants in POST /api/agents"
```

---

## Task 9: Wizard — Destination Picker + Category-Filtered Variants

**Files:**
- Modify: `src/components/agents/push-variant-picker.tsx`
- Modify: `src/components/agents/agent-wizard.tsx`

This task is UI-only — no integration tests. Verify manually by running `bun run dev` and creating an agent.

- [ ] **Step 1: Update `PushVariantPicker` to accept `category` prop and `sourceTemplateId`**

Replace the entire `src/components/agents/push-variant-picker.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { PushNotificationPreview } from "@/components/agents/push-notification-preview";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface VariantOption {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  sourceTemplateId: string | null;
  message: { channel: string; name: string };
}

interface PushVariantPickerProps {
  selectedVariantIds: string[];
  category?: string;
  onToggle: (variant: VariantOption) => void;
}

export function PushVariantPicker({ selectedVariantIds, category, onToggle }: PushVariantPickerProps) {
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const url = category ? `/api/variants?category=${encodeURIComponent(category)}` : "/api/variants";
    fetch(url)
      .then((r) => r.json())
      .then((data: VariantOption[]) => {
        setVariants(data.filter((v) => v.message.channel === "push"));
      })
      .finally(() => setLoading(false));
  }, [category]);

  if (loading) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Loading approved variants…</p>;
  }

  if (variants.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        {category
          ? `No approved variants for "${category}". Run the seed script: bun run scripts/seed-push-copy-templates.ts`
          : "No approved push variants found. Run the seed script first."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {variants.map((v) => {
        const selected = selectedVariantIds.includes(v.id);
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onToggle(v)}
            className={cn(
              "w-full text-left border rounded-lg p-3 transition-colors hover:border-primary/50",
              selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-background"
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="text-xs font-semibold">{v.name}</p>
                <p className="text-xs text-muted-foreground">{v.message.name}</p>
              </div>
              {selected && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
            </div>
            <div className="bg-gray-100 rounded-xl p-3 flex justify-center">
              <PushNotificationPreview
                title={v.title ?? undefined}
                body={v.body}
                deeplink={v.deeplink ?? undefined}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add `selectedCategory` state to `agent-wizard.tsx`**

In `src/components/agents/agent-wizard.tsx`, add after the `selectedPushVariants` state declaration (around line 132):

```ts
  const [selectedCategory, setSelectedCategory] = useState<string>("");
```

Also update the `selectedPushVariants` type to include `sourceTemplateId`:

```ts
  const [selectedPushVariants, setSelectedPushVariants] = useState<Array<{
    id: string; name: string; title: string | null; body: string;
    deeplink: string | null; cta: string | null; sourceTemplateId: string | null;
  }>>([]);
```

- [ ] **Step 3: Update `addMessage` to pass `sourceTemplateId`**

In `src/components/agents/agent-wizard.tsx`, update the `addMessage` function:

```ts
  const addMessage = () => {
    if (!newMsg.name.trim()) return;
    const variantsToSave = newMsg.channel === "push"
      ? selectedPushVariants.map((v) => ({
          ...emptyVariant(),
          name: v.name,
          title: v.title ?? "",
          body: v.body,
          deeplink: v.deeplink ?? "",
          cta: v.cta ?? "",
          sourceTemplateId: v.id,   // v.id is the template variant's id — the clone relationship
        }))
      : newMsg.variants;
    if (variantsToSave.length === 0) return;
    update("messages", [...form.messages, { ...newMsg, variants: variantsToSave }]);
    setNewMsg({ name: "", channel: "push", variants: [{ ...emptyVariant(), name: "V1" }] });
    setSelectedPushVariants([]);
    setSelectedCategory("");
  };
```

Also update `MessageDraft` to carry `sourceTemplateId` on variants:

```ts
interface MessageDraft {
  name: string;
  channel: Channel;
  variants: Array<{
    name: string;
    body: string;
    subject: string;
    cta: string;
    title: string;
    deeplink: string;
    iconImageUrl: string;
    preferredHour: number | null;
    preferredDayOfWeek: number | null;
    frequencyCapOverride: FrequencyCap | null;
    sourceTemplateId?: string;
  }>;
}
```

- [ ] **Step 4: Add destination picker and wire `category` to `PushVariantPicker` in Step 3 UI**

In `src/components/agents/agent-wizard.tsx`, replace the push channel section in Step 3 (the block starting `{newMsg.channel === "push" ? (`):

```tsx
            {newMsg.channel === "push" ? (
              <div className="pt-2 border-t space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Destination</p>
                  <div className="flex gap-2 flex-wrap">
                    {(["bible-verse", "guided-scripture", "plans", "general"] as const).map((cat) => {
                      const labels: Record<string, string> = {
                        "bible-verse": "Bible Verse",
                        "guided-scripture": "Guided Scripture",
                        "plans": "Plans",
                        "general": "General",
                      };
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            setSelectedCategory(cat);
                            setSelectedPushVariants([]);
                          }}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                            selectedCategory === cat
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background hover:border-primary/50"
                          )}
                        >
                          {labels[cat]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Select approved push variants</p>
                  <PushVariantPicker
                    selectedVariantIds={selectedPushVariants.map((v) => v.id)}
                    category={selectedCategory || undefined}
                    onToggle={(v) => {
                      setSelectedPushVariants((prev) => {
                        const exists = prev.some((p) => p.id === v.id);
                        return exists ? prev.filter((p) => p.id !== v.id) : [...prev, v];
                      });
                    }}
                  />
                  {selectedPushVariants.length > 0 && (
                    <p className="text-xs text-green-700 font-medium">
                      {selectedPushVariants.length} variant(s) selected
                    </p>
                  )}
                </div>
              </div>
            ) : (
```

Also reset `selectedCategory` when channel changes. Update the channel `Select` `onValueChange`:

```tsx
              <Select value={newMsg.channel} onValueChange={(v) => {
                setNewMsg((m) => ({ ...m, channel: v as Channel }));
                setSelectedPushVariants([]);
                setSelectedCategory("");
              }}>
```

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Lint**

```bash
bun run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/agents/push-variant-picker.tsx \
        src/components/agents/agent-wizard.tsx
git commit -m "feat: wizard destination picker filters templates by category; clones track sourceTemplateId"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
bun run check
```

Expected: lint clean, typecheck clean, all tests pass.

- [ ] **Run E2E suite to confirm nothing regressed**

```bash
bun run tests/e2e/braze-push.e2e.ts
```

Expected: `✅ All 12 E2E scenarios passed.`

- [ ] **Verify seed + wizard end-to-end** (manual, requires `bun run dev`)

1. Run `bun run scripts/seed-push-copy-templates.ts` (idempotent — safe if already run)
2. Open `http://localhost:3000/agents/new`
3. Fill in Basic Info + Goals
4. On Step 3, click "Bible Verse" → confirm only bible-verse variants appear
5. Click "Plans" → confirm only plans variants appear
6. Select 2 variants, click "Add Message", proceed through wizard
7. In the DB, confirm the created variants have `sourceTemplateId` pointing to the template IDs
8. PATCH a template variant via curl → confirm clones update:

```bash
# Get the template variant id from DB first, then:
curl -X PATCH http://localhost:3000/api/variants/<TEMPLATE_ID> \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated template title"}'
# Response should show clonesUpdated: N
```
