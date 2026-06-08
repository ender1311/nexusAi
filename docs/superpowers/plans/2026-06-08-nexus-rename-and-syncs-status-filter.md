# Sower→Nexus Copy Cleanup + Syncs Status Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product "Sower" → "Nexus" everywhere it is the product name (keeping the parable-of-the-sower metaphor), and add a status filter to the Data Ingest Syncs table.

**Architecture:** Two independent UI changes. (A) Static copy edits in two page files guarded by a source-content regression test. (B) New client-side `statusFilter` state in the existing `SyncsTable` component, rendered as toggleable status pills, composing with the existing Nexus-only + search filters and sort.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/ui, `bun:test` + happy-dom for component/regression tests.

**Spec:** `docs/superpowers/specs/2026-06-08-nexus-rename-and-syncs-status-filter-design.md`

---

### Task 1: Sower→Nexus copy cleanup (Part A)

**Files:**
- Modify: `src/app/about/page.tsx`
- Modify: `src/app/faq/page.tsx`
- Test: `tests/regression/product-name-nexus-copy.test.ts`

The product name "Sower" becomes "Nexus". The parable metaphor (sow, sowing,
seed, soil, scatter, harvest, bear fruit, field, yield) and the two approved
parable spots (`"Sower Agent"` vocab term L18, `"Sower vocabulary"` header L295)
stay. The guard test asserts the exact product-name strings, NOT the global
absence of "Sower" (which would falsely fail on the kept parable spots).

- [ ] **Step 1: Write the failing test**

Create `tests/regression/product-name-nexus-copy.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression: the product was renamed "Sower" → "Nexus". Guard the exact
// product-name copy strings so they don't silently regress. The parable
// metaphor (and the two approved parable spots "Sower Agent" / "Sower
// vocabulary") is intentionally preserved, so we assert specific product-name
// strings rather than the global absence of "Sower".

const root = join(import.meta.dir, "..", "..");
const about = readFileSync(join(root, "src/app/about/page.tsx"), "utf8");
const faq = readFileSync(join(root, "src/app/faq/page.tsx"), "utf8");

describe("product-name Nexus copy guard", () => {
  it("About page header, footer, and demo URLs say Nexus, not Sower", () => {
    expect(about).toContain('title="About Nexus"');
    expect(about).not.toContain('title="About Sower"');
    expect(about).toContain("NEXUS · YOUVERSION · INTERNAL");
    expect(about).not.toContain("SOWER · YOUVERSION");
    expect(about).toContain("nexus.youversion.com");
    expect(about).not.toContain("sower.youversion.com");
    expect(about).toContain("nexus.api/decide");
    expect(about).not.toContain("sower.api/decide");
  });

  it("About page body/headings refer to the product as Nexus", () => {
    expect(about).toContain("Nexus replaces broadcast sends");
    expect(about).toContain("Nexus vs. how we do it now.");
    expect(about).toContain("the day Nexus goes live.");
    expect(about).toContain("Nexus never stops learning.");
    expect(about).toContain("point Nexus at a campaign");
    expect(about).not.toContain("Sower replaces broadcast sends");
    expect(about).not.toContain("Sower vs. how we do it now.");
  });

  it("preserves the approved parable spots", () => {
    expect(about).toContain('"Sower Agent"');
    expect(about).toContain("Sower vocabulary");
    expect(about).toContain("Stop sowing blind.");
  });

  it("FAQ first question reads 'What is Nexus?'", () => {
    expect(faq).toContain('q: "What is Nexus?"');
    expect(faq).not.toContain('q: "What is Nexus (Sower)?"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/regression/product-name-nexus-copy.test.ts`
Expected: FAIL — current source still contains `title="About Sower"`, `SOWER · YOUVERSION`, `sower.youversion.com`, etc.

- [ ] **Step 3: Apply the copy edits**

In `src/app/faq/page.tsx`, line 10:

```tsx
        q: "What is Nexus?",
```
(was `q: "What is Nexus (Sower)?",`)

In `src/app/about/page.tsx`, make these exact replacements (parable terms in the
same lines stay untouched):

- L32 — inside the FEATURES array, "No more channel stitching" description:
```tsx
  { i: "◉", t: "No more channel stitching",      d: "Push, email, in-app — Nexus routes each user to the channel they actually engage on." },
```
- L34 — "No more guardrail anxiety" description:
```tsx
  { i: "▲", t: "No more guardrail anxiety",      d: "Set a churn floor and a revenue ceiling. Nexus steers within them or stops itself." },
```
- L109:
```tsx
      <Header title="About Nexus" description="What it is, how it works, and why it exists" />
```
- L142–143 (hero paragraph):
```tsx
              <p className="mt-6 text-base sm:text-lg leading-relaxed text-muted-foreground max-w-lg">
                Nexus replaces broadcast sends with a learning loop. Write the messages — Nexus decides
                who gets which one, watches what works, and steers the next round toward what bears fruit.
              </p>
```
- L166 (browser-bar mock URL):
```tsx
                    nexus.youversion.com / agent / streak-recovery
```
- L238 (feature-grid heading):
```tsx
                Six things you stop doing the day Nexus goes live.
```
- L261–262 (how-it-works paragraph):
```tsx
                  Nexus never stops learning. Each decision sharpens the next, so the longer it runs,
                  the better it gets at finding the right message for each person.
```
- L318 (comparison heading):
```tsx
              <h2 className="text-2xl sm:text-4xl font-semibold tracking-tight leading-tight">Nexus vs. how we do it now.</h2>
```
- L329 (comparison column header):
```tsx
                <div style={{ color: RED }}>Nexus</div>
```
- L366 (curl example):
```tsx
                <div className="text-muted-foreground">$ curl -X POST nexus.api/decide</div>
```
- L403 (CTA paragraph):
```tsx
                  Pick a goal, write a few seeds, point Nexus at a campaign. Within a day you&apos;ll see
```
- L427 (footer):
```tsx
            <span>NEXUS · YOUVERSION · INTERNAL · v0.4.2</span>
```

Do NOT change: the LOOP array (L10–15), the VOCAB array term `"Sower Agent"`
(L18), the "Sower vocabulary" table header (L295), or "Stop sowing blind." (L401).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/regression/product-name-nexus-copy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add src/app/about/page.tsx src/app/faq/page.tsx tests/regression/product-name-nexus-copy.test.ts
git commit -m "fix(copy): rename product Sower → Nexus, keep parable reference"
```

---

### Task 2: Syncs table status filter (Part B)

**Files:**
- Modify: `src/components/data-ingest/syncs-table.tsx`
- Test: `tests/regression/syncs-table-status-filter.test.tsx`

Add a `statusFilter: Set<string>` (empty = all). Render data-driven status pills
(one per status present in the currently-scoped list, with counts) plus an "All"
pill. Multi-select OR semantics. Compose inside the existing filter pipeline.

- [ ] **Step 1: Write the failing test**

Create `tests/regression/syncs-table-status-filter.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HightouchSync } from "@/lib/hightouch/types";

// Regression: the Syncs table had status SORT but no status FILTER. Users must
// be able to filter by status (failed/warning/success) via toggleable pills.

mock.module("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const { SyncsTable } = await import("@/components/data-ingest/syncs-table");
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sync(id: string, name: string, status: string): HightouchSync {
  return {
    id,
    name,
    slug: `nexus-${id}`,
    status,
    primaryKey: "id",
    modelId: "m1",
    destinationId: "d1",
    schedule: null,
    lastRunAt: "2026-06-08T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    configuration: {},
  } as HightouchSync;
}

const SYNCS: HightouchSync[] = [
  sync("1", "Alpha", "failed"),
  sync("2", "Bravo", "success"),
  sync("3", "Charlie", "success"),
  sync("4", "Delta", "warning"),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function pill(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => el.textContent?.trim().startsWith(label));
}

describe("SyncsTable status filter", () => {
  it("shows all syncs by default and renders a pill per present status with counts", () => {
    act(() => root.render(<SyncsTable syncs={SYNCS} models={[]} destinations={[]} hasApiKey />));
    const body = document.body.textContent ?? "";
    expect(body).toContain("Alpha");
    expect(body).toContain("Bravo");
    expect(body).toContain("Delta");
    expect(pill("Failed")).toBeDefined();
    expect(pill("Success")).toBeDefined();
    expect(pill("Warning")).toBeDefined();
    // count badge on the Success pill (2 success rows)
    expect(pill("Success")!.textContent).toContain("2");
  });

  it("filters to only failed rows when the Failed pill is clicked", () => {
    act(() => root.render(<SyncsTable syncs={SYNCS} models={[]} destinations={[]} hasApiKey />));
    act(() => pill("Failed")!.click());
    const body = document.body.textContent ?? "";
    expect(body).toContain("Alpha");
    expect(body).not.toContain("Bravo");
    expect(body).not.toContain("Charlie");
    expect(body).not.toContain("Delta");
  });

  it("clears the filter when the All pill is clicked", () => {
    act(() => root.render(<SyncsTable syncs={SYNCS} models={[]} destinations={[]} hasApiKey />));
    act(() => pill("Failed")!.click());
    act(() => pill("All")!.click());
    const body = document.body.textContent ?? "";
    expect(body).toContain("Alpha");
    expect(body).toContain("Bravo");
    expect(body).toContain("Delta");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/regression/syncs-table-status-filter.test.tsx`
Expected: FAIL — no status pills exist yet (`pill("Failed")` is undefined → throws on `.click()`).

- [ ] **Step 3: Implement the status filter**

In `src/components/data-ingest/syncs-table.tsx`:

(a) Add `statusFilter` state next to the existing state (after line 259):

```tsx
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
```

(b) Replace the existing `filtered` useMemo (lines 270–306) with a scoped list,
status counts, and a status-filtered+sorted list:

```tsx
  // Scope by Nexus-only + search (status counts are computed over this scope so
  // the pill counts match what the user is currently looking at).
  const scoped = useMemo(() => {
    let list = syncs;
    if (nexusOnly) {
      list = list.filter((s) => {
        const dest = destMap.get(String(s.destinationId));
        const destNexus =
          (dest?.name ?? "").toLowerCase().includes("nexus") ||
          (dest?.slug ?? "").toLowerCase().includes("nexus");
        const model = modelMap.get(String(s.modelId));
        const modelNexus =
          (model?.name ?? "").toLowerCase().includes("nexus") ||
          (model?.slug ?? "").toLowerCase().includes("nexus");
        const slugNexus = s.slug.toLowerCase().includes("nexus");
        return destNexus || modelNexus || slugNexus;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) =>
        syncDisplayName(s).toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (modelMap.get(String(s.modelId))?.name ?? "").toLowerCase().includes(q) ||
        (destMap.get(String(s.destinationId))?.name ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [syncs, nexusOnly, search, modelMap, destMap]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of scoped) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => statusSortKey(a[0]) - statusSortKey(b[0]));
  }, [scoped]);

  const filtered = useMemo(() => {
    let list = scoped;
    if (statusFilter.size > 0) list = list.filter((s) => statusFilter.has(s.status));
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === "status") cmp = statusSortKey(a.status) - statusSortKey(b.status);
      else if (sortField === "name") cmp = syncDisplayName(a).localeCompare(syncDisplayName(b));
      else if (sortField === "lastRun") {
        const ta = a.lastRunAt ? new Date(a.lastRunAt).getTime() : 0;
        const tb = b.lastRunAt ? new Date(b.lastRunAt).getTime() : 0;
        cmp = tb - ta;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [scoped, statusFilter, sortField, sortDir]);

  function toggleStatus(status: string) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }
```

(c) Add the status-pill row immediately after the existing filter-bar `</div>`
(after line 374, before the `<div className="rounded-lg border overflow-hidden">`):

```tsx
      {/* Status filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setStatusFilter(new Set())}
          className={cn(
            "text-xs px-2.5 py-1 rounded-full border transition-colors",
            statusFilter.size === 0
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-border hover:border-foreground",
          )}
        >
          All
        </button>
        {statusCounts.map(([status, count]) => (
          <button
            key={status}
            type="button"
            onClick={() => toggleStatus(status)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              statusFilter.has(status)
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-foreground",
            )}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)} {count}
          </button>
        ))}
      </div>
```

Note: the label is capitalized in JS (`Failed 1`, not `failed 1`) — not via the
CSS `capitalize` class — so the rendered `textContent` literally starts with
"Failed"/"Success"/"Warning" and the test's `startsWith` pill matcher works in
happy-dom (which doesn't apply CSS text-transform to `textContent`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/regression/syncs-table-status-filter.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run typecheck`
Expected: no errors.

```bash
git add src/components/data-ingest/syncs-table.tsx tests/regression/syncs-table-status-filter.test.tsx
git commit -m "feat(data-ingest): add status filter pills to syncs table"
```

---

### Task 3: Full check + push + MR

- [ ] **Step 1: Run the full check suite**

Run: `bun run check`
Expected: typecheck + lint + unit/contract + integration + regression all green.

- [ ] **Step 2: Push the branch and open the MR**

```bash
git push -u origin feat/nexus-rename-syncs-status-filter
glab mr create --fill --yes
```

- [ ] **Step 3: Poll until mergeable, then merge**

```bash
glab mr view --json detailed_merge_status
# wait until detailed_merge_status == "mergeable"
glab mr merge --yes
```
