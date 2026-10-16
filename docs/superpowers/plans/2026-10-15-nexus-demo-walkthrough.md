# Nexus Demo Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `beaconfrontier.com/nexus/demo`, a six-step interactive walkthrough of Hightouch → Nexus → content source → Braze → learning for a fictional brand ("Lumen"), with a content-source switch.

**Architecture:**
- A new route lives in `apps/site` (served under its existing `basePath: "/nexus"`), so no new zone is needed.
- All step data comes from one pure module, `lib/demo/build-step-data.ts`. It combines sample data with the real shared code: `@engine/*` for decisions and `@content-core/*` for mapping and activation.
- The UI is a thin client component, with its state synced to URL search params.

**Tech Stack:** Next 16, React 19, Tailwind v4, Bun test, Testing Library, Playwright (for smoke).

**Spec:** `docs/superpowers/specs/2026-10-15-nexus-demo-walkthrough-design.md`

**Depends on:** Content Sources plan Task 2 (`src/lib/content-core/`) being merged first.

## Global Constraints

- **Imports from the main app:** `apps/site` imports only `@engine/*` and `@content-core/*`. Never `@/…`, never a relative path into `../../src/`, and never anything that escapes those two directories.
- **No YouVersion:** no YouVersion name, content or numbers. The site's existing `tests/copy.test.ts` all-source scan must pass and must not be weakened.
- **Sample data is labelled:** every step showing sample data (1, 3 and 5) displays the word "Sample".
- **Determinism:** step outputs are deterministic. A fixed `asOf` for the feature vector (`new Date("2026-10-15T12:00:00Z")`) and a seeded RNG for Thompson, reusing `apps/site/lib/simulator/rng.ts` and its `Math.random` swap-and-restore pattern.
- **Feature labels:** two of the engine's 10 dimensions are vertical-specific (index 7 giving tier and index 8, a vertical engagement signal). They are labelled **"Vertical signal A"** and **"Vertical signal B (set by the vertical pack)"**, never with YouVersion terms.
- **Checks:** `bun run check:site` (eslint + tsc + tests) must be green, and root `bun run check:quick` must be green.
- **Commits:** commit only the files the task names. No attribution lines. If `next-env.d.ts` is rewritten by a build, restore it and don't commit it.

## Review Focus

1. **A deep link has a bad value** (`?step=9&source=foo`). Expected: it clamps to step 1–6, an unknown source falls back to `contentful`, and nothing crashes. *Test: Task 3.*
2. **Back from step 1, or Next from step 6.** Expected: the buttons are disabled at the ends and the arrow keys do nothing there. *Test: Task 3.*
3. **The source switch changes mid-walkthrough at step 5.** Expected: step 5 re-renders that source's activation mode immediately (reference for Braze Catalog, inline otherwise). *Test: Task 2, mode per source.*
4. **The visitor lands on `/nexus/demo` with JS disabled or before hydration.** Expected: the server-rendered page shows step 1 and its sample content, not a blank shell. *Test: Task 4 render test.*
5. **Step 6 is clicked repeatedly.** Expected: the Beta stats accumulate per click and "Reset" restores them. *Test: Task 2 and Task 3.*

---

### Task 1: Widen the site boundary to `@content-core`, and add the Lumen sample data

**Files:**
- Modify: `apps/site/tsconfig.json` (paths: add `"@content-core/*": ["../../src/lib/content-core/*"]`, and include `"../../src/lib/content-core/**/*.ts"`)
- Modify: `eslint.config.mjs` (the apps/site rule)
- Create: `apps/site/content/demo-lumen.ts`
- Test: `apps/site/tests/demo-boundary.test.ts`

**Interfaces:**
- Produces:
  - the `@content-core/*` alias;
  - `LUMEN_USER` (a warehouse row);
  - `LUMEN_PERSONAS: { id; label; centroid: number[] }[]` (4 personas, 10-dim centroids);
  - `LUMEN_CONTENT: { contentful: unknown[]; sanity: unknown[]; genericJson: { record: unknown[]; mapping: FieldMapping }; brazeCatalog: unknown[]; nexusLibrary: ContentItem[] }`, with 4 items each;
  - `DEMO_SOURCES = ["contentful", "sanity", "generic-json", "braze-catalog", "nexus-library"] as const` and `type DemoSource`;
  - `FEATURE_LABELS: string[10]`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/site/tests/demo-boundary.test.ts
import { describe, expect, it } from "bun:test";
import { applyFieldMapping, DEFAULT_MAPPINGS } from "@content-core/index";
import { DEMO_SOURCES, FEATURE_LABELS, LUMEN_CONTENT, LUMEN_PERSONAS } from "@site/content/demo-lumen";

describe("demo sample data", () => {
  it("imports content-core through the alias", () => {
    expect(typeof applyFieldMapping).toBe("function");
  });
  it("every Contentful sample entry maps cleanly with the default mapping", () => {
    for (const e of LUMEN_CONTENT.contentful) {
      expect("item" in applyFieldMapping(e, DEFAULT_MAPPINGS.contentful, { channel: "push" })).toBe(true);
    }
  });
  it("has 4 personas with 10-dim centroids, 10 feature labels, 5 sources", () => {
    expect(LUMEN_PERSONAS).toHaveLength(4);
    for (const p of LUMEN_PERSONAS) expect(p.centroid).toHaveLength(10);
    expect(FEATURE_LABELS).toHaveLength(10);
    expect(FEATURE_LABELS.join(" ")).not.toMatch(/spirit|giving|bible/i);
    expect(DEMO_SOURCES).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement**

Run: `bun run --cwd apps/site test tests/demo-boundary.test.ts`. Expected: FAIL.

In `eslint.config.mjs` (the apps/site block):
- keep the `@/*` ban and the `../src` regex;
- change the escape regex to `^@(engine|content-core)/.*\\.\\.` with the message `"@engine/* and @content-core/* must not escape their directories."`;
- update the `@/*` message to "apps/site may import only @engine/* and @content-core/* from the main app.".

`apps/site/content/demo-lumen.ts` holds all sample data, typed. Lumen is a wellness/meditation app.
- **`LUMEN_USER`:**

  ```ts
  { externalId: "lumen-user-1832", attributes: { plan: "free", locale: "en", sessions_7d: 5, last_open_hour: 7, days_since_last_open: 2, streak_days: 4 }, totalDecisions: 18, totalConversions: 3, totalReward: 3, channelStats: { push: { sent: 12, opened: 4 }, email: { sent: 6, opened: 2 } }, hourlyStats: { 7: 6, 8: 3, 21: 2 }, dailyStats: { sat: 3, sun: 2 } }
  ```

  Match the shapes to what `computeFeatureVector` reads. Open `src/lib/engine/feature-vector.ts` and use the field names it actually parses.
- **`LUMEN_PERSONAS`:** "Morning routine", "Evening wind-down", "Weekend explorer", "Drifting away", each with a 10-number centroid in [0,1].
- **`LUMEN_CONTENT.contentful`:** 4 entries in real Contentful Delivery shape (`sys.id`, `sys.updatedAt`, `fields.title|body|cta|deeplink` as `{"en-US": …}` locale maps, plus an `es` body on one entry, and `metadata.tags`). Topics: "2-minute breathing", "Sleep story", "Streak nudge", "Upgrade to Lumen Plus".
- **`sanity`:** the same 4 as Sanity docs (`_id`, `_updatedAt`, `title`, `body`, `cta`, `deeplink`, `tags`).
- **`genericJson`:** `{ record: [ { id, headline, text, button, url, labels } ×4 ], mapping: { externalRef: "id", title: "headline", body: "text", cta: "button", deeplink: "url", tags: "labels" } }`.
- **`brazeCatalog`:** 4 items (`id: "tip_1"…`, `title`, `body`, `cta`, `deeplink`, `tags`).
- **`nexusLibrary`:** 4 `ContentItem`s.
- **`FEATURE_LABELS`:** `["Push engagement","Email engagement","Morning activity","Evening activity","Weekend activity","Conversion rate","Recency","Vertical signal A","Vertical signal B (set by the vertical pack)","Engagement frequency"]`. Check that the order matches the dimension order documented in `feature-vector.ts`, and adjust the generic labels to that order.

- [ ] **Step 3: Run it to verify it passes, then commit**

Run: `bun run check:site`.

```bash
git add apps/site/tsconfig.json eslint.config.mjs apps/site/content/demo-lumen.ts apps/site/tests/demo-boundary.test.ts
git commit -m "feat(site): @content-core alias and Lumen sample data for the demo"
```

---

### Task 2: `build-step-data` (pure step logic)

**Files:**
- Create: `apps/site/lib/demo/build-step-data.ts`
- Test: `apps/site/tests/build-step-data.test.ts`

**Interfaces:**
- Consumes:
  - `computeFeatureVector` from `@engine/feature-vector`;
  - `ThompsonSampling` from `@engine/thompson-sampling`;
  - `applyFieldMapping`, `DEFAULT_MAPPINGS`, `buildActivationProperties`, `brazeCatalogLiquid`, `ContentItem` from `@content-core/index`;
  - `mulberry32` from `@site/lib/simulator/rng`;
  - the Task 1 sample data.
- Produces:
  - `stepIngest(): { warehouseRow; hightouchRecord; ingestRequest: { method: "POST"; path: "/api/ingest/users"; body: unknown } }`
  - `stepFeatures(): { vector: number[]; labelled: { label: string; value: number }[]; persona: { id: string; label: string; distance: number } }`
  - `stepContent(source: DemoSource): { sourceRecord: unknown; mapping: FieldMapping | null; item: ContentItem; items: ContentItem[] }`
  - `stepDecide(source: DemoSource, seed?: number): { chosen: ContentItem; arms: { item: ContentItem; estimate: number; uncertainty: number }[] }`
  - `stepActivate(source: DemoSource, channel: "content_card" | "push"): { mode: "inline" | "reference"; endpoint: string; body: Record<string, unknown>; liquid: string | null }`
  - `type ArmStats = { alpha: number; beta: number }`
  - `stepLearn(stats: ArmStats, converted: boolean): ArmStats`
  - `INITIAL_ARM_STATS: Record<string, ArmStats>`, keyed by externalRef. The initial stats are uneven, so Thompson has a believable lead.
  - `DEMO_AS_OF`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/site/tests/build-step-data.test.ts
import { describe, expect, it } from "bun:test";
import { contentItemSchema } from "@content-core/index";
import { DEMO_SOURCES } from "@site/content/demo-lumen";
import { stepActivate, stepContent, stepDecide, stepFeatures, stepIngest, stepLearn } from "@site/lib/demo/build-step-data";

describe("demo step data", () => {
  it("step 1 builds the ingest request from the warehouse row", () => {
    const s = stepIngest();
    expect(s.ingestRequest.path).toBe("/api/ingest/users");
    expect(JSON.stringify(s.ingestRequest.body)).toContain("lumen-user-1832");
  });

  it("step 2 is deterministic, 10-dim, values in [0,1], nearest persona", () => {
    const a = stepFeatures(), b = stepFeatures();
    expect(a).toEqual(b);
    expect(a.vector).toHaveLength(10);
    for (const v of a.vector) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(a.labelled[8]!.label).toContain("Vertical signal B");
    expect(typeof a.persona.label).toBe("string");
  });

  it("step 3 yields a valid ContentItem for every source", () => {
    for (const s of DEMO_SOURCES) {
      const r = stepContent(s);
      expect(contentItemSchema.safeParse(r.item).success).toBe(true);
      expect(r.items).toHaveLength(4);
    }
  });

  it("step 4 is deterministic per seed and reports estimates for every arm", () => {
    const a = stepDecide("contentful", 7), b = stepDecide("contentful", 7);
    expect(a.chosen.externalRef).toBe(b.chosen.externalRef);
    expect(a.arms).toHaveLength(4);
    for (const arm of a.arms) expect(arm.uncertainty).toBeGreaterThan(0);
  });

  it("step 4 restores Math.random", () => {
    const orig = Math.random;
    stepDecide("sanity", 1);
    expect(Math.random).toBe(orig);
  });

  it("step 5 uses reference mode only for braze-catalog on triggered channels", () => {
    const ref = stepActivate("braze-catalog", "content_card");
    expect(ref.mode).toBe("reference");
    expect((ref.body.trigger_properties as Record<string, string>).catalog_item_id).toBeDefined();
    expect(ref.liquid).toContain("catalog_items");
    for (const s of ["contentful", "sanity", "generic-json", "nexus-library"] as const) {
      const r = stepActivate(s, "content_card");
      expect(r.mode).toBe("inline");
      expect(JSON.stringify(r.body)).not.toContain("catalog_item_id");
    }
    const push = stepActivate("braze-catalog", "push");
    expect(push.endpoint).toBe("/messages/send");
    expect(JSON.stringify(push.body)).not.toContain("catalog_item_id");
  });

  it("step 6 updates Beta stats", () => {
    expect(stepLearn({ alpha: 3, beta: 10 }, true)).toEqual({ alpha: 4, beta: 10 });
    expect(stepLearn({ alpha: 3, beta: 10 }, false)).toEqual({ alpha: 3, beta: 11 });
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `bun run --cwd apps/site test tests/build-step-data.test.ts`. Expected: FAIL.

Implementation notes. Write the module in full; these are the required behaviours:
- `DEMO_AS_OF = new Date("2026-10-15T12:00:00Z")`. `stepFeatures` calls `computeFeatureVector({ ...LUMEN_USER stats, attributes, asOf: DEMO_AS_OF })`. The persona is the minimum Euclidean distance to the `LUMEN_PERSONAS` centroids.
- `stepContent`:
  - Contentful, Sanity and Braze Catalog map each record with `applyFieldMapping(record, DEFAULT_MAPPINGS[source], { channel: source === "braze-catalog" ? "content_card" : "push" })`;
  - generic JSON uses its own sample mapping;
  - `nexus-library` returns its items directly, with `mapping: null`.
  - `item` is `items[0]`. If any record fails to map, throw: sample data must be valid.
- `stepDecide`: arms = `items.map(i => ({ id: i.externalRef, stats: { alpha, beta, tries: alpha + beta - 2, wins: alpha - 1 } }))` using `INITIAL_ARM_STATS` (the same four alpha/beta pairs for every source, assigned by item index). Swap `Math.random` for `mulberry32(seed ?? 42)` inside `try/finally`, and call `new ThompsonSampling().select(arms)`. Each arm's estimate is `alpha / (alpha + beta)`, and its uncertainty is `1.96 * sqrt(alpha*beta / ((a+b)^2 (a+b+1)))`.
- `stepActivate`: take the chosen item from `stepDecide(source, 42)`.
  - `mode = source === "braze-catalog" && channel === "content_card" ? "reference" : "inline"`.
  - For `content_card`, the endpoint is `/campaigns/trigger/send` and the body is `{ campaign_id: "lumen-content-card-campaign", trigger_properties: buildActivationProperties({ contentSource: source, externalRef: item.externalRef, title: item.title ?? null, body: item.body, cta: item.cta ?? null, link: item.deeplink ?? null }, mode), recipients: [{ external_user_id: "lumen-user-1832" }] }`.
  - For `push`, the endpoint is `/messages/send` and the body is `{ external_user_ids: ["lumen-user-1832"], messages: { apple_push: { alert: { title: item.title, body: item.body } } } }`.
  - `liquid = mode === "reference" ? brazeCatalogLiquid("lumen_tips") : null`.

- [ ] **Step 3: Run to verify it passes, then commit**

Run: `bun run check:site`.

```bash
git add apps/site/lib/demo/build-step-data.ts apps/site/tests/build-step-data.test.ts
git commit -m "feat(site): pure step builders for the demo walkthrough"
```

---

### Task 3: The walkthrough UI

**Files:**
- Create: `apps/site/components/demo/walkthrough.tsx` (client: step and source state, URL sync, keys, rail, Next/Back)
- Create: `apps/site/components/demo/steps/step-1-ingest.tsx`, `step-2-features.tsx`, `step-3-content.tsx`, `step-4-decide.tsx`, `step-5-activate.tsx`, `step-6-learn.tsx`
- Create: `apps/site/components/demo/code-block.tsx` (a JSON pretty-printer `<pre>` with a "Sample" label prop)
- Create: `apps/site/lib/demo/url-state.ts` (pure: `parseDemoParams(sp: URLSearchParams): { step: 1..6; source: DemoSource }` and `toSearch(step, source): string`)
- Test: `apps/site/tests/url-state.test.ts`, `apps/site/tests/walkthrough.test.tsx`

**Interfaces:**
- Consumes: Task 2's step builders and `DEMO_SOURCES` / `DemoSource`.
- Produces:
  - `<Walkthrough initialStep={number} initialSource={DemoSource} />`
  - `parseDemoParams`, `toSearch`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/site/tests/url-state.test.ts
import { describe, expect, it } from "bun:test";
import { parseDemoParams, toSearch } from "@site/lib/demo/url-state";

describe("demo url state", () => {
  it("parses valid params", () => {
    expect(parseDemoParams(new URLSearchParams("step=5&source=braze-catalog"))).toEqual({ step: 5, source: "braze-catalog" });
  });
  it("clamps bad steps and falls back on unknown sources", () => {
    expect(parseDemoParams(new URLSearchParams("step=9&source=foo"))).toEqual({ step: 6, source: "contentful" });
    expect(parseDemoParams(new URLSearchParams("step=-2"))).toEqual({ step: 1, source: "contentful" });
    expect(parseDemoParams(new URLSearchParams("step=abc"))).toEqual({ step: 1, source: "contentful" });
  });
  it("round-trips", () => {
    expect(parseDemoParams(new URLSearchParams(toSearch(3, "sanity")))).toEqual({ step: 3, source: "sanity" });
  });
});
```

```tsx
// apps/site/tests/walkthrough.test.tsx
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Walkthrough } from "@site/components/demo/walkthrough";

afterEach(cleanup);

describe("Walkthrough", () => {
  it("disables Back on step 1 and Next on step 6", () => {
    render(<Walkthrough initialStep={1} initialSource="contentful" />);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<Walkthrough initialStep={6} initialSource="contentful" />);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switching to Braze Catalog on step 5 shows catalog_item_id; Contentful does not", () => {
    render(<Walkthrough initialStep={5} initialSource="contentful" />);
    expect(screen.queryByText(/catalog_item_id/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /braze catalog/i }));
    expect(screen.getAllByText(/catalog_item_id/).length).toBeGreaterThan(0);
  });

  it("labels sample data on steps 1, 3 and 5", () => {
    for (const step of [1, 3, 5]) {
      render(<Walkthrough initialStep={step} initialSource="contentful" />);
      expect(screen.getAllByText(/^Sample/).length).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("step 6 accumulates and resets", () => {
    render(<Walkthrough initialStep={6} initialSource="contentful" />);
    const before = screen.getByTestId("arm-alpha").textContent;
    fireEvent.click(screen.getByRole("button", { name: /user converted/i }));
    fireEvent.click(screen.getByRole("button", { name: /user converted/i }));
    expect(Number(screen.getByTestId("arm-alpha").textContent)).toBe(Number(before) + 2);
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(screen.getByTestId("arm-alpha").textContent).toBe(before);
  });
});
```

- [ ] **Step 2: Run to verify they fail, then implement**

- **`url-state.ts`:** `step = clamp(parseInt(sp.get("step") ?? "1", 10) || 1, 1, 6)`; `source = DEMO_SOURCES.includes(x) ? x : "contentful"`; `toSearch` returns `?step=N&source=S`.
- **`walkthrough.tsx`** (`"use client"`):
  - state `{ step, source }`, initialised from props;
  - on change, `history.replaceState(null, "", toSearch(...))`, with no router navigation;
  - `keydown` ArrowLeft/ArrowRight move the step within 1–6, attached on `window` and removed on unmount;
  - a step rail: an `<ol>` of 6 buttons labelled "1 Hightouch", "2 Features", "3 Content", "4 Decide", "5 Braze", "6 Learn", with `aria-current="step"` on the active one;
  - Back and Next buttons;
  - the content-source switch, shown on steps 3–5, as a `radiogroup` with 5 radios labelled "Contentful", "Sanity", "Generic JSON", "Braze Catalog", "Nexus library";
  - it renders the active step component, passing the `source`;
  - on step 6, the end CTAs: "Become a design partner" (`href="/nexus#design-partner"`) and "Back to the simulator" (`href="/nexus#simulator"`).
- **Steps** render from the Task 2 builders. Each step has a 1–2 sentence explanation, the live element, and a `CodeBlock` with the payload:
  - Step 1: warehouse row → Hightouch record → ingest request; the CodeBlock is labelled "Sample".
  - Step 2: labelled bars for the 10 features, plus a persona chip.
  - Step 3: source record (Sample) → mapping table (field → path) → resulting ContentItem.
  - Step 4: arms table (estimate ± interval) with the chosen arm highlighted, and a "Pick again" button that bumps the seed.
  - Step 5: a channel toggle (Content card / Push), the endpoint, the body CodeBlock (Sample), and the Liquid block when reference mode is on, with the text "Braze renders the catalog item Nexus picked."
  - Step 6: the chosen arm's α/β shown with `data-testid="arm-alpha"` / `"arm-beta"`, and buttons "User converted", "No conversion" and "Reset", using `stepLearn`.
- Styling uses the site's CSS variables and Tailwind, like the simulator. Long code blocks use `overflow-x-auto` so the page never scrolls sideways at 375px.

- [ ] **Step 3: Run to verify they pass, then commit**

Run: `bun run check:site`.

```bash
git add apps/site/components/demo apps/site/lib/demo/url-state.ts apps/site/tests/url-state.test.ts apps/site/tests/walkthrough.test.tsx
git commit -m "feat(site): six-step demo walkthrough UI with content-source switch and deep links"
```

---

### Task 4: The route, entry links, connectors, copy rules and smoke test

**Files:**
- Create: `apps/site/app/demo/page.tsx`
- Modify: `apps/site/components/sections/how-it-works.tsx` (add the link "See the full loop step by step →" to `/nexus/demo`)
- Modify: `apps/site/content/connectors.ts` (add a `kind: "content"` group: `contentful`, `sanity`, `generic-json`, `braze-catalog` and `nexus-library`, with `status` taken from `CONTENT_SOURCE_STATUS` below)
- Modify: `apps/site/components/sections/stack-strip.tsx` (add a third column, "Content from")
- Modify: `apps/site/tests/connectors.test.ts`, `apps/site/tests/copy.test.ts`, `apps/site/smoke/site.spec.ts`
- Test: `apps/site/tests/demo-page.test.tsx`

**Interfaces:**
- Consumes: `<Walkthrough />` and `parseDemoParams` (Task 3).
- Produces: the `/nexus/demo` route and `contentSources()` in `connectors.ts`.

- [ ] **Step 1: Write the failing tests**

- `demo-page.test.tsx` renders `await DemoPage({ searchParams: Promise.resolve({ step: "3", source: "sanity" }) })`, the server component. It asserts that the step 3 heading and the "Sanity" radio are checked. A second case with no params renders step 1's heading. This pins Review Focus 4: the server render is not blank.
- `connectors.test.ts`:
  - `contentSources().map(c => c.id)` equals `["contentful","sanity","generic-json","braze-catalog","nexus-library"]`;
  - `nexus-library` is `live`;
  - the others' `status` equals `CONTENT_SOURCE_STATUS[id]`.
- `copy.test.ts`: add `app/demo` and `components/demo` to the scanned source. `allSiteText` already recurses over `app` and `components`, so confirm it covers them.

- [ ] **Step 2: Run to verify they fail, then implement**

```tsx
// apps/site/app/demo/page.tsx
import type { Metadata } from "next";
import { Walkthrough } from "@site/components/demo/walkthrough";
import { parseDemoParams } from "@site/lib/demo/url-state";

export const metadata: Metadata = {
  title: "Nexus demo: the full loop, step by step",
  description: "Follow one user from Hightouch through Nexus and your content source to Braze, and watch the agent learn. Sample data, real Nexus code.",
  alternates: { canonical: "/nexus/demo" },
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = new URLSearchParams(Object.entries(raw).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  const { step, source } = parseDemoParams(sp);
  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <a href="/nexus" className="text-sm text-[var(--muted)]">← Nexus</a>
      <h1 className="mt-4 text-3xl font-bold sm:text-4xl">The full loop, step by step</h1>
      <p className="mt-2 text-[var(--muted)]">One Lumen user, from Hightouch to Braze and back. The data is sample data; the decisions and payloads come from Nexus&apos;s real code.</p>
      <div className="mt-8"><Walkthrough initialStep={step} initialSource={source} /></div>
    </main>
  );
}
```

In `connectors.ts`, add `export const CONTENT_SOURCE_STATUS = { contentful: "live", sanity: "live", "generic-json": "live", "braze-catalog": "live", "nexus-library": "live" } as const;`.

- **Ruling recorded here:** set each value to `"live"` only once Content Sources plan Task 10 has shipped and the live check passed for that source. Until then, use `"roadmap"` for every source except `nexus-library`.
- The controller flips these in Task 5.
- Extend `Connector["kind"]` with `"content"` and add `contentSources()`. In `stack-strip.tsx`, render a third column, "Content from", with `connectorLabel` pills.

Extend the smoke test with a second test that opens `/nexus/demo?step=5&source=braze-catalog` and expects `catalog_item_id` to be visible.

- [ ] **Step 3: Run to verify they pass, then build**

Run: `bun run check:site`, then `bun run --cwd apps/site build`. The route list must include `/demo`. Restore `next-env.d.ts` afterwards.

Then do a visual check with a dev server on a free port. If no browser is available, `curl` `/nexus/demo` and confirm step 1's heading is in the HTML.

- [ ] **Step 4: Commit**

```bash
git add apps/site/app/demo/page.tsx apps/site/components/sections/how-it-works.tsx apps/site/content/connectors.ts apps/site/components/sections/stack-strip.tsx apps/site/tests/connectors.test.ts apps/site/tests/copy.test.ts apps/site/tests/demo-page.test.tsx apps/site/smoke/site.spec.ts
git commit -m "feat(site): /nexus/demo route, entry links, content-source connectors, smoke test"
```

---

### Task 5: Deploy (the controller runs this)

- [ ] **Step 1:** Once the Content Sources Task 10 live checks pass, flip `CONTENT_SOURCE_STATUS` to `"live"` for each verified source and commit.
- [ ] **Step 2:** Push `main`. The pre-push hook runs `check:quick`. Wait for `nexus-site` to be Ready.
- [ ] **Step 3:** Check that `curl -s -o /dev/null -w "%{http_code}" https://beaconfrontier.com/nexus/demo` returns `200`, then run `bunx playwright test` in `apps/site` (both smoke tests).

---

## Self-review notes

- **Spec coverage:**

  | Spec section | Covered by |
  |---|---|
  | §2 decisions | Global Constraints and Task 1 |
  | §3 steps | Tasks 2–3 |
  | §4 code layout | Tasks 1–4 |
  | §5 tests | Tasks 1–4 |
  | Status labels | Task 4 ruling and Task 5 |

- **Deviation from the spec:** the spec puts `content/demo-lumen.ts` and the step components exactly as laid out here. The added `lib/demo/url-state.ts` exists so the deep-link logic can be unit tested.
