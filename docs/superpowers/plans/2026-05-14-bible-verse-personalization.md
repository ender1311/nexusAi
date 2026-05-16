# Bible Verse Personalization — Send Cron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the send cron selects a `specific-verse` push variant for a user, fetch the verse text in the user's preferred Bible version and use it as the push title instead of the stored NIV default.

**Architecture:** A new pure module (`src/lib/bible-verse.ts`) handles Bible API fetches. The cron extends `variantMeta` to carry `subcategory` and `usfms` (from `actionFeatures`). Before building send groups, it batch-fetches verse texts for all unique `(usfms, versionId)` pairs required by the run. Each specific-verse variant group is keyed by `variantId:scheduledAt:inLocalTime:v{versionId}` so users with different preferred versions get separate Braze calls with the correct verse text. Users without a preference, or whose version fetch fails, fall back to the stored NIV title.

**Tech Stack:** Bun, TypeScript, Next.js App Router, Prisma v7, YouVersion Bible API (`bible.youversionapi.com/3.1/verse.json`)

---

## File Structure

| Path | Action | Purpose |
|------|--------|---------|
| `src/lib/bible-verse.ts` | **Create** | Pure fetch module — `fetchVerseBatch` only |
| `tests/unit/bible-verse.test.ts` | **Create** | Unit tests with mocked `fetch` |
| `tests/helpers/builders.ts` | **Modify** | Add `actionFeatures` to `createVariant` overrides |
| `scripts/seed-votd-specific-verse.ts` | **Modify** | Store `usfms` array in `actionFeatures` |
| `scripts/backfill-votd-usfms.ts` | **Create** | One-time script: patch existing variants missing USFM |
| `src/app/api/cron/select-and-send/route.ts` | **Modify** | Extend variantMeta, resolve verse texts, version-aware group keys |
| `tests/integration/cron-send.test.ts` | **Modify** | Add a personalization test case |
| `docs/bible-personalization.md` | **Create** | Architecture note + Option A (Connected Content) for future |

---

### Task 1: `src/lib/bible-verse.ts` — pure verse-fetch module

**Context:** No Bible API client exists yet. The seed script has inline fetch logic; we extract it into a shared module. The YouVersion Bible API requires specific headers (Referer, X-YouVersion-Client, X-YouVersion-App-Platform, X-YouVersion-App-Version). For multi-verse variants (e.g. Isaiah 43:18–19, stored as two USFMs), we fetch each separately and join the text with a space.

**Files:**
- Create: `src/lib/bible-verse.ts`
- Create: `tests/unit/bible-verse.test.ts`

---

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/bible-verse.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { fetchVerseBatch, DEFAULT_VERSION_ID } from "@/lib/bible-verse";

let _originalFetch: typeof globalThis.fetch;

const makeVerseResponse = (content: string, human: string) =>
  new Response(
    JSON.stringify({ response: { data: { content, reference: { human } } } }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );

const makeEmptyResponse = () =>
  new Response(JSON.stringify({ response: { data: null } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  _originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = _originalFetch;
});

describe("fetchVerseBatch", () => {
  it("exports DEFAULT_VERSION_ID as 111 (NIV)", () => {
    expect(DEFAULT_VERSION_ID).toBe(111);
  });

  it("returns empty map for empty input", async () => {
    const result = await fetchVerseBatch([]);
    expect(result.size).toBe(0);
  });

  it("fetches single-USFM variant and returns text", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      return makeVerseResponse("For I know the plans I have for you", "Jeremiah 29:11");
    };

    const result = await fetchVerseBatch([{ usfms: ["JER.29.11"], versionId: 111 }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("id=111");
    expect(calls[0]).toContain("reference=JER.29.11");
    expect(result.get("JER.29.11:111")).toBe("For I know the plans I have for you");
  });

  it("joins multi-USFM variant text with a space", async () => {
    let callCount = 0;
    globalThis.fetch = async (input) => {
      callCount++;
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("ISA.43.18")) return makeVerseResponse("Forget the former things;", "Isaiah 43:18");
      return makeVerseResponse("See, I am doing a new thing!", "Isaiah 43:19");
    };

    const result = await fetchVerseBatch([{ usfms: ["ISA.43.18", "ISA.43.19"], versionId: 116 }]);
    expect(callCount).toBe(2);
    expect(result.get("ISA.43.18+ISA.43.19:116")).toBe(
      "Forget the former things; See, I am doing a new thing!"
    );
  });

  it("returns null entry (key absent) when API returns no content", async () => {
    globalThis.fetch = async () => makeEmptyResponse();
    const result = await fetchVerseBatch([{ usfms: ["BAD.1.1"], versionId: 111 }]);
    expect(result.has("BAD.1.1:111")).toBe(false);
  });

  it("returns null entry when fetch throws", async () => {
    globalThis.fetch = async () => { throw new Error("network error"); };
    const result = await fetchVerseBatch([{ usfms: ["GEN.1.1"], versionId: 111 }]);
    expect(result.has("GEN.1.1:111")).toBe(false);
  });

  it("deduplicates identical (usfms, versionId) pairs", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return makeVerseResponse("Trust in the Lord", "Proverbs 3:5");
    };

    const result = await fetchVerseBatch([
      { usfms: ["PRO.3.5"], versionId: 111 },
      { usfms: ["PRO.3.5"], versionId: 111 },
    ]);
    expect(callCount).toBe(1); // deduplicated
    expect(result.get("PRO.3.5:111")).toBe("Trust in the Lord");
  });

  it("fetches multiple distinct requests in parallel", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.includes("JER.29.11")) return makeVerseResponse("Plans for hope", "Jeremiah 29:11");
      return makeVerseResponse("I can do all things", "Philippians 4:13");
    };

    const result = await fetchVerseBatch([
      { usfms: ["JER.29.11"], versionId: 111 },
      { usfms: ["PHP.4.13"], versionId: 59 },
    ]);
    expect(calls).toHaveLength(2);
    expect(result.get("JER.29.11:111")).toBe("Plans for hope");
    expect(result.get("PHP.4.13:59")).toBe("I can do all things");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/danluk/repos/nexus && bun run test:quick 2>&1 | grep -A3 "bible-verse"
```

Expected: `Cannot find module '@/lib/bible-verse'`

- [ ] **Step 3: Create `src/lib/bible-verse.ts`**

```typescript
const VERSE_URL = "https://bible.youversionapi.com/3.1/verse.json";

export const DEFAULT_VERSION_ID = 111; // NIV 2011

const HEADERS = {
  Referer: "http://yvapi.youversionapi.com",
  "X-YouVersion-Client": "youversion",
  "X-YouVersion-App-Platform": "internal",
  "X-YouVersion-App-Version": "1",
};

/** Cache key for a given usfms array + versionId. */
export function verseCacheKey(usfms: string[], versionId: number): string {
  return `${usfms.join("+")}:${versionId}`;
}

async function fetchSingleVerse(usfm: string, versionId: number): Promise<string | null> {
  try {
    const url = `${VERSE_URL}?id=${versionId}&reference=${encodeURIComponent(usfm)}`;
    const res = await fetch(url, { headers: HEADERS });
    const json = (await res.json()) as {
      response: { data?: { content?: string } };
    };
    const text = json.response?.data?.content;
    if (!text) return null;
    return text.replace(/\n/g, " ").trim();
  } catch {
    return null;
  }
}

export type VerseFetchRequest = { usfms: string[]; versionId: number };

/**
 * Batch-fetch verse texts for multiple (usfms[], versionId) requests in parallel.
 * Deduplicates identical requests. Returns a map keyed by `verseCacheKey(usfms, versionId)`.
 * Missing entries (failed fetches) are absent from the map — callers fall back to stored NIV title.
 */
export async function fetchVerseBatch(
  requests: VerseFetchRequest[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (requests.length === 0) return result;

  // Deduplicate
  const unique = new Map<string, VerseFetchRequest>();
  for (const req of requests) {
    const key = verseCacheKey(req.usfms, req.versionId);
    if (!unique.has(key)) unique.set(key, req);
  }

  await Promise.all(
    [...unique.entries()].map(async ([key, { usfms, versionId }]) => {
      const texts: string[] = [];
      for (const usfm of usfms) {
        const text = await fetchSingleVerse(usfm, versionId);
        if (text) texts.push(text);
      }
      if (texts.length === usfms.length) {
        // Only store result if ALL usfms resolved — partial verse is wrong
        result.set(key, texts.join(" "));
      }
    })
  );

  return result;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/danluk/repos/nexus && bun run test:quick 2>&1 | grep -E "bible-verse|pass|fail" | head -20
```

Expected: all 7 `bible-verse` tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/danluk/repos/nexus && git add src/lib/bible-verse.ts tests/unit/bible-verse.test.ts && git commit -m "feat: add bible-verse fetch module with batch dedup"
```

---

### Task 2: Extend builder + update seed script + backfill script

**Context:** The test builder at `tests/helpers/builders.ts` doesn't accept `actionFeatures`. The existing 365 specific-verse variants were seeded without the `usfms` array in `actionFeatures` — they only have `sourceFile: "votd-day-N"`. We need to:
1. Add `actionFeatures` to the `createVariant` builder so tests can set it
2. Update the seed script to store USFMs going forward
3. Write a one-time backfill script that re-fetches the VOTD schedule and patches all existing specific-verse variants

**Files:**
- Modify: `tests/helpers/builders.ts`
- Modify: `scripts/seed-votd-specific-verse.ts`
- Create: `scripts/backfill-votd-usfms.ts`

---

- [ ] **Step 1: Extend `createVariant` in builders.ts**

Open `tests/helpers/builders.ts` and extend the `createVariant` overrides type to include `actionFeatures`:

```typescript
// Find the createVariant function (around line 56) and update its overrides type:
export async function createVariant(
  messageId: string,
  overrides: {
    name?: string;
    body?: string;
    title?: string | null;
    brazeVariantId?: string | null;
    brazeCanvasStepId?: string | null;
    status?: string;
    deeplink?: string | null;
    category?: string | null;
    subcategory?: string | null;
    iconImageUrl?: string | null;
    sourceTemplateId?: string | null;
    actionFeatures?: object | null;  // ← ADD THIS LINE
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

- [ ] **Step 2: Update seed script to store usfms in actionFeatures**

In `scripts/seed-votd-specific-verse.ts`, find the `prisma.messageVariant.create` call (around line 151) and add `usfms` to `actionFeatures`:

```typescript
    await prisma.messageVariant.create({
      data: {
        messageId: message.id,
        name: human,
        title,
        body: human,
        deeplink: "youversion://bible",
        cta: "Read Today's Verse",
        category: "reader",
        subcategory: "specific-verse",
        status: "active",
        actionFeatures: {
          tone: "empathy",
          hasPersonalization: false,
          ctaType: "deeplink",
          messageLengthBucket: lengthBucket,
          sourceFile: `votd-day-${day}`,
          usfms,                          // ← ADD THIS: the raw USFM array
        },
      },
    });
```

- [ ] **Step 3: Create `scripts/backfill-votd-usfms.ts`**

```typescript
/**
 * One-time backfill: add `usfms` array to actionFeatures on existing specific-verse variants
 * that were seeded before the field was added.
 *
 * Safe to re-run — skips variants that already have actionFeatures.usfms.
 *
 * Usage: bun run scripts/backfill-votd-usfms.ts
 */
import { prisma } from "../src/lib/db";

const VOTD_URL = "https://moments.youversionapi.com/3.1/votd.json";
const HEADERS = {
  Referer: "http://yvapi.youversionapi.com",
  "X-YouVersion-Client": "youversion",
  "X-YouVersion-App-Platform": "internal",
  "X-YouVersion-App-Version": "1",
};

type VotdDay = { day: number; usfms: string[] };

async function fetchVotdDays(): Promise<VotdDay[]> {
  const res = await fetch(`${VOTD_URL}?type=standard`, { headers: HEADERS });
  const json = (await res.json()) as { response: { data: { day: number; usfm: string[] }[] } };
  return json.response.data.map((item) => ({ day: item.day, usfms: item.usfm }));
}

async function main() {
  console.log("🔧 Backfilling VOTD USFMs into actionFeatures...\n");

  const votdDays = await fetchVotdDays();
  const dayToUsfms = new Map(votdDays.map((d) => [d.day, d.usfms]));
  console.log(`  ✓ Fetched VOTD schedule: ${votdDays.length} days\n`);

  // Load all specific-verse variants
  const variants = await prisma.messageVariant.findMany({
    where: { subcategory: "specific-verse" },
    select: { id: true, actionFeatures: true },
  });
  console.log(`  Found ${variants.length} specific-verse variants`);

  let patched = 0;
  let skipped = 0;
  let failed = 0;

  for (const v of variants) {
    const af = v.actionFeatures as Record<string, unknown> | null;
    if (af?.usfms) { skipped++; continue; }

    // Extract day number from sourceFile e.g. "votd-day-42"
    const sourceFile = af?.sourceFile as string | undefined;
    const dayMatch = sourceFile?.match(/votd-day-(\d+)/);
    if (!dayMatch) { failed++; console.log(`  ✗ No sourceFile for variant ${v.id}`); continue; }

    const day = parseInt(dayMatch[1], 10);
    const usfms = dayToUsfms.get(day);
    if (!usfms) { failed++; console.log(`  ✗ Day ${day} not in VOTD schedule`); continue; }

    await prisma.messageVariant.update({
      where: { id: v.id },
      data: { actionFeatures: { ...(af ?? {}), usfms } },
    });
    patched++;
  }

  console.log(`\n✅ Done — ${patched} patched, ${skipped} already had USFMs, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 4: Verify builder change compiles**

```bash
cd /Users/danluk/repos/nexus && bun run typecheck 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/danluk/repos/nexus && git add tests/helpers/builders.ts scripts/seed-votd-specific-verse.ts scripts/backfill-votd-usfms.ts && git commit -m "feat: store usfms in actionFeatures for specific-verse variants; add backfill script"
```

---

### Task 3: Cron — extend variantMeta + resolve verse texts + version-aware groups

**Context:** This is the core cron change. Three sub-steps:
1. Extend `variantMeta` type to include `subcategory` and `usfms`.
2. After user→variant assignments are collected in `lotteryDecisionInputs` / `decisionInputs`, batch-fetch verse texts for all unique `(usfms, versionId)` pairs.
3. In the byVariant grouping loop, for `specific-verse` variants, add versionId to the group key and use the fetched verse text as the title.

Both the lottery path and the in-window path need the same treatment.

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts` (lines ~1–1378)
- Modify: `tests/integration/cron-send.test.ts`

---

- [ ] **Step 1: Write the failing integration test**

Open `tests/integration/cron-send.test.ts` and add this test inside the existing `describe("POST /api/cron/select-and-send", ...)` block. Add it before the closing `});` of the describe block.

The test requires intercepting both Braze AND the Bible API. The existing `beforeEach` already intercepts Braze by checking for `rest.test.braze.com`. Extend it to intercept `bible.youversionapi.com` too:

Find the `beforeEach` block and update the mock fetch:

```typescript
// In beforeEach, replace the fetch mock with this extended version:
(globalThis as Record<string, unknown>).fetch = async (
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.includes("rest.test.braze.com")) {
    brazeRequests.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    return new Response(JSON.stringify({ message: "success" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("bible.youversionapi.com")) {
    // Return version-specific text to verify personalization
    const versionId = new URL(url).searchParams.get("id");
    const content = versionId === "116"
      ? "ESV text for test verse"
      : "NIV text for test verse";
    return new Response(
      JSON.stringify({ response: { data: { content, reference: { human: "Test 1:1" } } } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  return _originalFetch(input, init);
};
```

Now add the new test case:

```typescript
it("uses user's preferred Bible version for specific-verse push title", async () => {
  const persona = await createPersona();
  const agent = await createAgent({ status: "active", funnelStage: "wau" });
  await linkAgentToPersona(agent.id, persona.id);
  await createSchedulingRule(agent.id);
  const msg = await createMessage(agent.id, { channel: "push" });

  // specific-verse variant with USFM stored in actionFeatures
  const variant = await createVariant(msg.id, {
    title: "NIV text for test verse",  // stored NIV fallback
    body: "Test 1:1",
    subcategory: "specific-verse",
    deeplink: "youversion://bible",
    actionFeatures: { usfms: ["TST.1.1"] },
  });

  // User with preferred version 116 (ESV)
  const user116 = await createUser("user-v116", {
    personaId: persona.id,
    attributes: { push_enabled: true, language_tag: "en", preferred_bible_version_id: 116 },
  });
  // User with no preference — falls back to NIV (v111)
  const userDefault = await createUser("user-default", {
    personaId: persona.id,
    attributes: { push_enabled: true, language_tag: "en" },
  });

  await prisma.personaArmStats.createMany({
    data: [
      { personaId: persona.id, agentId: agent.id, variantId: variant.id, alpha: 10, beta: 1, tries: 11, wins: 10 },
    ],
  });

  const req = buildRequest("POST", undefined, CRON_AUTH);
  const res = await POST(req as NextRequest);
  expect(res.status).toBe(200);

  const pushCalls = brazeRequests.filter(
    (r) => r.url.includes("/messages/send") || r.url.includes("/messages/schedule/create")
  );
  expect(pushCalls.length).toBeGreaterThanOrEqual(1);

  // Find the Braze call for the v116 user — should have ESV text
  const v116Call = pushCalls.find((r) => {
    const body = r.body as { recipients?: Array<{external_user_id?: string}>; external_user_ids?: string[] };
    const ids = body.recipients?.map((x) => x.external_user_id) ?? body.external_user_ids ?? [];
    return ids.includes("user-v116");
  });
  expect(v116Call).toBeDefined();
  const v116Payload = v116Call!.body as { messages?: { android_push?: { title?: string } } };
  expect(v116Payload.messages?.android_push?.title).toBe("ESV text for test verse");

  // Default-version user should have NIV text (either fetched or stored fallback)
  const defaultCall = pushCalls.find((r) => {
    const body = r.body as { recipients?: Array<{external_user_id?: string}>; external_user_ids?: string[] };
    const ids = body.recipients?.map((x) => x.external_user_id) ?? body.external_user_ids ?? [];
    return ids.includes("user-default");
  });
  expect(defaultCall).toBeDefined();
  const defaultPayload = defaultCall!.body as { messages?: { android_push?: { title?: string } } };
  expect(defaultPayload.messages?.android_push?.title).toBe("NIV text for test verse");
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /Users/danluk/repos/nexus && bun run test:int -- --testNamePattern "preferred Bible version" 2>&1 | tail -15
```

Expected: test fails (the cron currently sends the same title for all users).

- [ ] **Step 3: Add imports and helper functions to the cron route**

At the top of `src/app/api/cron/select-and-send/route.ts`, add the import after the existing imports:

```typescript
import { fetchVerseBatch, verseCacheKey, DEFAULT_VERSION_ID } from "@/lib/bible-verse";
```

Then after the `blendArm` function (around line 40), add two helper functions:

```typescript
/** Extract the user's preferred Bible version ID from their attributes JSON. */
function getUserVersionId(attrs: Record<string, unknown> | null | undefined): number {
  const raw = attrs?.preferred_bible_version_id;
  if (raw == null) return DEFAULT_VERSION_ID;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  return isNaN(n) || n <= 0 ? DEFAULT_VERSION_ID : n;
}

/** True when a variant meta entry is a specific-verse template with stored USFMs. */
function isSpecificVerse(meta: {
  subcategory: string | null;
  usfms: string[] | null;
} | undefined): meta is { subcategory: "specific-verse"; usfms: string[] } {
  return meta?.subcategory === "specific-verse" &&
    Array.isArray(meta.usfms) &&
    meta.usfms.length > 0;
}
```

- [ ] **Step 4: Extend `variantMeta` type and population**

Find the `variantMeta` declaration (around line 488) and replace it:

```typescript
// Build variant detail lookup: variantId → { channel, body, title, deeplink, brazeCampaignId, brazeVariantId, subcategory, usfms }
const variantMeta = new Map<string, {
  channel: string;
  body: string;
  title: string | null;
  deeplink: string | null;
  brazeCampaignId: string | null;
  brazeVariantId: string | null;
  subcategory: string | null;
  usfms: string[] | null;
}>();
for (const msg of agent.messages) {
  for (const v of msg.variants) {
    const af = v.actionFeatures as Record<string, unknown> | null;
    const usfms = Array.isArray(af?.usfms) ? (af!.usfms as string[]) : null;
    variantMeta.set(v.id, {
      channel:         msg.channel,
      body:            v.body,
      title:           v.title ?? null,
      deeplink:        v.deeplink ?? null,
      brazeCampaignId: msg.brazeCampaignId ?? null,
      brazeVariantId:  v.brazeVariantId ?? null,
      subcategory:     v.subcategory ?? null,
      usfms,
    });
  }
}
```

- [ ] **Step 5: Add verse text pre-fetch after the lottery `lotteryDecisionInputs` is built**

Find the comment `// Bulk-create all UserDecision records in one createManyAndReturn call` (around line 837) — the `if (lotteryDecisionInputs.length > 0)` block. Inside that block, just BEFORE the `const decisionData2 = ...` declaration, add:

```typescript
        // Pre-fetch personalized verse texts for specific-verse variants.
        // Collect unique (usfms, versionId) pairs so we make one API call per distinct pair.
        const lotteryVerseCache = new Map<string, string>();
        {
          const versePairs: Array<{ usfms: string[]; versionId: number }> = [];
          for (const { user, variantId } of lotteryDecisionInputs) {
            const meta = variantMeta.get(variantId);
            if (!isSpecificVerse(meta)) continue;
            const versionId = getUserVersionId(user.attributes as Record<string, unknown> | null);
            versePairs.push({ usfms: meta.usfms, versionId });
          }
          if (versePairs.length > 0) {
            const fetched = await fetchVerseBatch(versePairs);
            for (const [k, v] of fetched) lotteryVerseCache.set(k, v);
          }
        }
```

- [ ] **Step 6: Update the lottery byVariant group-building loop**

Find the loop starting `for (const { user, variantId, scheduledAt, inLocalTime: isFallback } of lotteryDecisionInputs)` (around line 871). Replace the group-key calculation and `title` assignment:

Find this block:
```typescript
          const groupInLocalTime = isFallback;
          const groupKey = `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}`;

          if (!byVariant[groupKey]) {
            byVariant[groupKey] = {
              variantId,
              brazeVariantId:  meta.brazeVariantId,
              brazeCampaignId: meta.brazeCampaignId,
              channel:         meta.channel,
              body:            meta.body,
              title:           meta.title,
              deeplink:        meta.deeplink,
              inLocalTime:     groupInLocalTime,
              scheduledAt,
              externalUserIds: [],
              brazeOnlyIds:    new Set(),
              decisionIds:     [],
            };
          }
```

Replace with:
```typescript
          const groupInLocalTime = isFallback;
          const isVerseVariant = isSpecificVerse(meta);
          const versionId = isVerseVariant
            ? getUserVersionId(user.attributes as Record<string, unknown> | null)
            : 0;
          const resolvedTitle = isVerseVariant
            ? (lotteryVerseCache.get(verseCacheKey(meta.usfms, versionId)) ?? meta.title)
            : meta.title;
          const groupKey = isVerseVariant
            ? `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}:v${versionId}`
            : `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}`;

          if (!byVariant[groupKey]) {
            byVariant[groupKey] = {
              variantId,
              brazeVariantId:  meta.brazeVariantId,
              brazeCampaignId: meta.brazeCampaignId,
              channel:         meta.channel,
              body:            meta.body,
              title:           resolvedTitle,
              deeplink:        meta.deeplink,
              inLocalTime:     groupInLocalTime,
              scheduledAt,
              externalUserIds: [],
              brazeOnlyIds:    new Set(),
              decisionIds:     [],
            };
          }
```

- [ ] **Step 7: Add verse text pre-fetch and version-aware groups to the in-window path**

Find the analogous section for window users. Look for the comment `// Bulk-create all UserDecision records in one createMany call` (around line 1185) — the `const decisionData = ...` block. Just BEFORE `const decisionData`, add:

```typescript
        // Pre-fetch personalized verse texts for specific-verse variants (window path).
        const windowVerseCache = new Map<string, string>();
        {
          const versePairs: Array<{ usfms: string[]; versionId: number }> = [];
          for (const { user, variantId } of decisionInputs) {
            const meta = variantMeta.get(variantId);
            if (!isSpecificVerse(meta)) continue;
            const versionId = getUserVersionId(user.attributes as Record<string, unknown> | null);
            versePairs.push({ usfms: meta.usfms, versionId });
          }
          if (versePairs.length > 0) {
            const fetched = await fetchVerseBatch(versePairs);
            for (const [k, v] of fetched) windowVerseCache.set(k, v);
          }
        }
```

Find the window byVariant group-building loop starting `for (const { user, variantId, scheduledAt, inLocalTime: isFallback } of decisionInputs)` (around line 1222). Replace the group-key and title with the same pattern as Step 6 — but using `windowVerseCache` instead of `lotteryVerseCache`:

Find:
```typescript
          const groupInLocalTime = isFallback;
          const groupKey = `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}`;

          if (!windowByVariant[groupKey]) {
            windowByVariant[groupKey] = {
              variantId,
              brazeVariantId:  meta.brazeVariantId,
              brazeCampaignId: meta.brazeCampaignId,
              channel:         meta.channel,
              body:            meta.body,
              title:           meta.title,
              deeplink:        meta.deeplink,
              inLocalTime:     groupInLocalTime,
              scheduledAt,
              externalUserIds: [],
              brazeOnlyIds:    new Set(),
              decisionIds:     [],
            };
          }
```

Replace with:
```typescript
          const groupInLocalTime = isFallback;
          const isVerseVariantW = isSpecificVerse(meta);
          const versionIdW = isVerseVariantW
            ? getUserVersionId(user.attributes as Record<string, unknown> | null)
            : 0;
          const resolvedTitleW = isVerseVariantW
            ? (windowVerseCache.get(verseCacheKey(meta.usfms, versionIdW)) ?? meta.title)
            : meta.title;
          const groupKey = isVerseVariantW
            ? `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}:v${versionIdW}`
            : `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}`;

          if (!windowByVariant[groupKey]) {
            windowByVariant[groupKey] = {
              variantId,
              brazeVariantId:  meta.brazeVariantId,
              brazeCampaignId: meta.brazeCampaignId,
              channel:         meta.channel,
              body:            meta.body,
              title:           resolvedTitleW,
              deeplink:        meta.deeplink,
              inLocalTime:     groupInLocalTime,
              scheduledAt,
              externalUserIds: [],
              brazeOnlyIds:    new Set(),
              decisionIds:     [],
            };
          }
```

- [ ] **Step 8: Run typecheck and integration test**

```bash
cd /Users/danluk/repos/nexus && bun run typecheck 2>&1 | tail -5
```

Expected: no errors.

```bash
cd /Users/danluk/repos/nexus && bun run test:int -- --testNamePattern "preferred Bible version" 2>&1 | tail -20
```

Expected: test passes.

- [ ] **Step 9: Run the full quick check**

```bash
cd /Users/danluk/repos/nexus && bun run check:quick 2>&1 | tail -10
```

Expected: all checks pass.

- [ ] **Step 10: Commit**

```bash
cd /Users/danluk/repos/nexus && git add src/app/api/cron/select-and-send/route.ts tests/integration/cron-send.test.ts && git commit -m "feat: personalize specific-verse push title by user's preferred Bible version"
```

---

### Task 4: Docs — bible personalization architecture note

**Context:** Document current Option B approach and explain Option A (Braze Connected Content via API-triggered Campaign) clearly so a future engineer can pick it up.

**Files:**
- Create: `docs/bible-personalization.md`

---

- [ ] **Step 1: Create the doc**

Create `docs/bible-personalization.md`:

```markdown
# Bible Verse Personalization

Nexus can personalize push notification verse text to each user's preferred Bible version.

## Current Implementation — Option B: Server-side resolution

When the send cron selects a `specific-verse` variant for a user, it reads
`TrackedUser.attributes.preferred_bible_version_id` and fetches the verse text in that version
via `bible.youversionapi.com/3.1/verse.json`. The personalized text replaces the stored
NIV title before the Braze payload is sent.

**How it works:**
1. Each specific-verse `MessageVariant` stores the USFM reference(s) in
   `actionFeatures.usfms` (e.g. `["ISA.43.18", "ISA.43.19"]`).
2. The cron collects all `(usfms, versionId)` pairs needed for the current run,
   calls `fetchVerseBatch` once (parallel, deduped), and caches results.
3. Users with the same variant but different preferred versions are grouped into
   separate Braze batches so each gets the correct text.
4. Users without `preferred_bible_version_id` fall back to version 111 (NIV 2011).

**Coverage:** ~16% of users have a preferred version set (1.16M of 7.1M as of May 2026).
Top versions: v111 (NIV), v116, v59, v1 (KJV), v114.

**Trade-offs:**
- ~10–30 extra Bible API calls per cron run when specific-verse variants are selected
- These run in parallel; typical latency addition < 500ms
- Braze batch efficiency slightly reduced (more groups per variant), but still large batches

---

## Future Option A: Braze Connected Content (API-triggered Campaign)

Braze Connected Content (`{% connected_content %}` Liquid tags) **only executes inside
Braze Campaigns and Canvases**, NOT in direct API sends via `/messages/send`. When Nexus
posts to `/messages/send`, Braze treats the `title`/`body` fields as literal strings.

To use Connected Content for verse text:

1. Create an **API-triggered Campaign** in the Braze console with a template like:
   ```
   Title: {% connected_content https://bible.youversionapi.com/3.1/verse.json?id={{${preferred_bible_version_id}}}&reference={{custom_attribute.${selected_usfm}}} :save verse %}{{ verse.response.data.content }}
   ```
2. Change the Nexus send cron to POST to Braze's
   [trigger campaign endpoint](https://www.braze.com/docs/api/endpoints/messaging/send_messages/post_send_triggered_campaign/)
   instead of `/messages/send`, passing `campaign_id` + per-user `trigger_properties`
   containing the selected USFM.
3. Braze handles the HTTP fetch at send time, including caching and retry.

**Why it's not implemented yet:**
- Requires a persistent Braze Campaign configuration (operational coupling)
- Nexus's architecture keeps push content fully in-code — no Braze console dependencies
- Option B handles the same use case without external dependencies
- Option A would be worth revisiting if Braze adds richer caching or retry semantics
  that Option B can't match, or if verse fetching volume grows significantly.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/danluk/repos/nexus && git add docs/bible-personalization.md && git commit -m "docs: bible verse personalization architecture (Option B implemented, Option A noted)"
```

---

### Task 5: Clean up and final check

**Files:**
- Delete: `scripts/check-version-coverage.ts`

---

- [ ] **Step 1: Delete the one-off diagnostic script**

```bash
cd /Users/danluk/repos/nexus && git rm scripts/check-version-coverage.ts
```

- [ ] **Step 2: Run the full check suite**

```bash
cd /Users/danluk/repos/nexus && bun run check:quick 2>&1 | tail -15
```

Expected: all checks pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/danluk/repos/nexus && git add -u && git commit -m "chore: remove one-off version-coverage diagnostic script"
```

---

## Execution Notes

- **Run the backfill script** after deploying: `bun run scripts/backfill-votd-usfms.ts` — patches the 365 existing specific-verse variants to add `usfms` to their `actionFeatures`. Safe to re-run.
- **Testing caveat:** The integration test intercepts `bible.youversionapi.com` calls via the existing fetch mock pattern in `cron-send.test.ts`. The Bible API mock returns version-specific text ("ESV text" for v116, "NIV text" otherwise) to verify the personalization path.
- **No schema changes** — `actionFeatures` is already a `Json?` field; we're just populating a new key within it.
