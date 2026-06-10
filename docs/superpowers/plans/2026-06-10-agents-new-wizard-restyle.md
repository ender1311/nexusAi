# /agents/new Wizard Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the 5-step `/agents/new` wizard to the Settings-tab design language (Cards, InfoTip, Row summaries), extract the duplicated SegmentCheckList into one shared component, surface validation hints instead of silently disabled buttons, and stop channel switches from discarding message drafts.

**Architecture:** All wizard state, step flow, and the POST `/api/agents` payload stay untouched. Changes are presentational (Card wrappers, labels, hints) plus two surgical behavior fixes: a shared `SegmentCheckList` component consumed by both the wizard and `agent-settings-editor.tsx`, and per-channel message drafts (`Record<Channel, MessageDraft>`) replacing the single `newMsg` draft.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui (`Card`, `InfoTip`), bun:test + happy-dom for component tests.

---

## Repo ground rules (read first)

- Spec: `docs/superpowers/specs/2026-06-10-agents-new-wizard-restyle-design.md`. Branch: `feat/agents-new-wizard-restyle` (already created).
- **Never** run `prisma migrate dev` / `db push`. **Never** use `git stash` or any destructive git command. Only `git add` the files each task lists.
- Test commands:
  - Quick gate: `bun run check:quick` (~30s, typecheck + lint + unit/contract).
  - A single regression test file: `TEST_FILES=tests/regression/<file> bun run test:int-reg` — exactly ONE file per invocation; multiple space-separated files fail.
  - `bun run test:int` ignores TEST_FILES — don't use it for single files.
- A PostToolUse hook auto-runs ESLint on every `.ts`/`.tsx` write — its messages are informational.
- happy-dom ignores CSS `text-transform`; render uppercase text via `toUpperCase()` in JS so test assertions on textContent work.
- The global test preload mocks `next/navigation`'s `useRouter` (no `refresh`); component tests can render client components that call `useRouter()`.

---

### Task 1: Shared SegmentCheckList component

The identical 56-line `SegmentCheckList` is defined twice: `src/components/agents/agent-wizard.tsx:149-205` and `src/components/agents/agent-settings-editor.tsx:108-164` (each preceded by a local `type SegmentOption`). Extract it to one shared file with two small improvements: a taller scroll area (`max-h-72` instead of `max-h-48`) and a footer count line so long lists aren't silently cut off.

**Files:**
- Create: `src/components/agents/segment-check-list.tsx`
- Modify: `src/components/agents/agent-wizard.tsx` (remove lines 147–205: the `SegmentOption` type + `SegmentCheckList` function; add import)
- Modify: `src/components/agents/agent-settings-editor.tsx` (remove lines 104–164: the comment, `SegmentOption` type + `SegmentCheckList` function; add import)
- Test: `tests/regression/agents-segment-check-list-single-source.test.ts`

- [ ] **Step 1: Write the failing regression test**

```ts
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Regression: SegmentCheckList was duplicated verbatim (56 lines each) in
// agent-wizard.tsx and agent-settings-editor.tsx. The wizard restyle
// (2026-06-10) extracted a single shared component. This pins the
// single-source rule so a future edit can't silently re-inline a copy.

const componentsDir = join(import.meta.dir, "../../src/components/agents");

describe("SegmentCheckList single source", () => {
  it("is defined exactly once, in the shared file", () => {
    const sharedPath = join(componentsDir, "segment-check-list.tsx");
    expect(existsSync(sharedPath)).toBe(true);
    const shared = readFileSync(sharedPath, "utf8");
    expect(shared).toContain("export function SegmentCheckList");
  });

  it("wizard and settings editor import it instead of re-declaring it", () => {
    for (const file of ["agent-wizard.tsx", "agent-settings-editor.tsx"]) {
      const src = readFileSync(join(componentsDir, file), "utf8");
      expect(src).not.toContain("function SegmentCheckList");
      expect(src).toMatch(/from "(\.\/|@\/components\/agents\/)segment-check-list"/);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `TEST_FILES=tests/regression/agents-segment-check-list-single-source.test.ts bun run test:int-reg`
Expected: FAIL — shared file does not exist; both files still declare `function SegmentCheckList`.

- [ ] **Step 3: Create the shared component**

`src/components/agents/segment-check-list.tsx` — the body of the map is byte-identical to the deleted copies; only the wrapper (scroll area + footer) is new:

```tsx
"use client";

import { cn } from "@/lib/utils";

export type SegmentOption = { name: string; userCount: number; assignedTo: string | null };

export function SegmentCheckList({
  segments,
  selected,
  currentAgentTargetNames,
  onChange,
}: {
  segments: SegmentOption[];
  selected: string[];
  currentAgentTargetNames: string[];
  onChange: (next: string[]) => void;
}) {
  if (segments.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No segments synced yet — run a Hightouch segment sync first.</p>;
  }
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="max-h-72 overflow-y-auto">
        {segments.map((s) => {
          const isSelected = selected.includes(s.name);
          const isTaken = s.assignedTo !== null && !currentAgentTargetNames.includes(s.name);
          const isDisabled = isTaken && !isSelected;
          return (
            <button
              key={s.name}
              type="button"
              disabled={isDisabled}
              onClick={() => {
                onChange(isSelected ? selected.filter((n) => n !== s.name) : [...selected, s.name]);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors border-b last:border-b-0",
                isSelected ? "bg-primary/5 text-foreground" : "hover:bg-muted/50",
                isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
              )}
            >
              <span className={cn(
                "h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center",
                isSelected ? "bg-primary border-primary" : "border-input bg-background",
              )}>
                {isSelected && (
                  <svg className="h-2.5 w-2.5 text-primary-foreground" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {s.userCount >= 1000 ? `${(s.userCount / 1000).toFixed(0)}K` : s.userCount} users
                  {isTaken && s.assignedTo ? ` · ${s.assignedTo}` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="border-t bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        {segments.length} segment{segments.length === 1 ? "" : "s"}
        {selected.length > 0 ? ` · ${selected.length} selected` : ""}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Swap both consumers to the import**

In `src/components/agents/agent-wizard.tsx`:
1. Delete lines 147–205 (`type SegmentOption = …` through the closing `}` of `function SegmentCheckList`).
2. Add to the imports block:

```ts
import { SegmentCheckList, type SegmentOption } from "@/components/agents/segment-check-list";
```

In `src/components/agents/agent-settings-editor.tsx`:
1. Delete lines 104–164 (the `// ---- Segment-pick checkbox list…` comment, `type SegmentOption = …`, and `function SegmentCheckList …`).
2. Add next to the other relative imports (`./agent-color-picker` etc.):

```ts
import { SegmentCheckList, type SegmentOption } from "./segment-check-list";
```

Both files reference `SegmentOption` elsewhere (wizard: `useState<SegmentOption[]>`; settings editor: its segments state) — the type import covers those.

- [ ] **Step 5: Run the regression test + quick gate**

Run: `TEST_FILES=tests/regression/agents-segment-check-list-single-source.test.ts bun run test:int-reg`
Expected: PASS (2 tests).
Run: `bun run check:quick`
Expected: EXIT 0.

- [ ] **Step 6: Verify the settings-editor regression suites still pass**

Run (one at a time):
`TEST_FILES=tests/regression/agent-settings-single-edit-surface.test.ts bun run test:int-reg`
`TEST_FILES=tests/regression/agent-config-mutation-error-handling.test.tsx bun run test:int-reg`
Expected: PASS for both. Note: `agent-settings-single-edit-surface` asserts source text of the settings editor — the SegmentCheckList removal must not break it (it only checks for deleted edit-surface files and redirect markers, not SegmentCheckList).

- [ ] **Step 7: Commit**

```bash
git add src/components/agents/segment-check-list.tsx src/components/agents/agent-wizard.tsx src/components/agents/agent-settings-editor.tsx tests/regression/agents-segment-check-list-single-source.test.ts
git commit -m "refactor(agents): extract shared SegmentCheckList with count footer"
```

---

### Task 2: Step-1 restyle + validation hints

Restyle the Basic Info step into Cards matching the Settings tab, rename "HT Segment" → "Segment", explain the epsilon slider, and surface inline hint text whenever Next/Launch is disabled.

**Files:**
- Modify: `src/components/agents/agent-wizard.tsx`
- Test: `tests/regression/agent-wizard-validation-hints.test.tsx`

- [ ] **Step 1: Write the failing component test**

`tests/regression/agent-wizard-validation-hints.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression: the wizard's Next button disabled silently on step 1 — users got
// no explanation of what was missing until step 5 or a backend rejection.
// The 2026-06-10 restyle added inline hint text mirroring the gating logic.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AgentWizard } = await import("@/components/agents/agent-wizard");

let container: HTMLDivElement;
let root: Root;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/segments")) {
      return new Response(
        JSON.stringify({ data: [{ name: "VIP", userCount: 1200, assignedTo: null }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function typeInto(input: HTMLInputElement, next: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function nextButtons() {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
    (b) => b.textContent?.trim() === "Next",
  );
}

function clickButtonByText(text: string) {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === text,
  )!;
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("AgentWizard step-1 validation hints", () => {
  it("walks the hint through name → funnel stage and disables Next meanwhile", async () => {
    act(() => {
      root.render(<AgentWizard personas={[]} />);
    });
    await flush();

    expect(container.textContent).toContain("Enter an agent name to continue.");
    expect(nextButtons().every((b) => b.disabled)).toBe(true);

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Recommend Bible Plans"]',
    )!;
    typeInto(nameInput, "My Agent");

    expect(container.textContent).not.toContain("Enter an agent name to continue.");
    expect(container.textContent).toContain("Choose a funnel stage to continue.");
    expect(nextButtons().every((b) => b.disabled)).toBe(true);
  });

  it("in segment mode, hints for includes and enables Next once one is picked", async () => {
    act(() => {
      root.render(<AgentWizard personas={[]} />);
    });
    await flush();

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Recommend Bible Plans"]',
    )!;
    typeInto(nameInput, "My Agent");

    clickButtonByText("Segment");
    expect(container.textContent).toContain("Select at least one include segment to continue.");
    expect(nextButtons().every((b) => b.disabled)).toBe(true);

    // The include SegmentCheckList renders first; its VIP row is the first match.
    const vipRow = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("VIP"),
    )!;
    act(() => {
      vipRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Select at least one include segment");
    expect(nextButtons().every((b) => !b.disabled)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `TEST_FILES=tests/regression/agent-wizard-validation-hints.test.tsx bun run test:int-reg`
Expected: FAIL — hint strings don't exist yet, and the mode-toggle button is labeled "HT Segment", so `clickButtonByText("Segment")` finds nothing.

- [ ] **Step 3: Add the hint logic and shared disabled expression**

In `agent-wizard.tsx`, inside `AgentWizard` (after `handleSubmit`), add:

```ts
// Mirrors the Next-button gating; rendered as inline hint text so a disabled
// button always explains itself.
const step1Hint = !form.name.trim()
  ? "Enter an agent name to continue."
  : form.segmentMode && form.segmentIncludes.length === 0
    ? "Select at least one include segment to continue."
    : !form.segmentMode && !form.funnelStage
      ? "Choose a funnel stage to continue."
      : null;
const launchHint = !form.name.trim() ? "Enter an agent name before launching." : null;
```

Replace BOTH duplicated disabled expressions (top nav line 450, bottom nav line 1239):
`disabled={step === 1 && (!form.name.trim() || (form.segmentMode ? form.segmentIncludes.length === 0 : !form.funnelStage))}` → `disabled={step === 1 && step1Hint !== null}`.

Replace both Launch buttons' `disabled={saving || !form.name.trim()}` → `disabled={saving || launchHint !== null}`.

Render the hint under each nav row. Top nav: change the wrapper `<div className="flex items-center justify-between mb-6 pb-4 border-b">` block to:

```tsx
<div className="mb-6 pb-4 border-b">
  <div className="flex items-center justify-between">
    {/* existing Back + Next/Launch buttons unchanged */}
  </div>
  {step === 1 && step1Hint && (
    <p className="mt-2 text-xs text-muted-foreground text-right">{step1Hint}</p>
  )}
  {step === 5 && launchHint && (
    <p className="mt-2 text-xs text-muted-foreground text-right">{launchHint}</p>
  )}
</div>
```

Bottom nav (`<div className="flex items-center justify-between mt-8 pt-4 border-t">`): same treatment — outer `<div className="mt-8 pt-4 border-t">`, inner flex row, then the same two conditional `<p>` hints.

- [ ] **Step 4: Restyle step 1 into Cards**

Add to imports: `import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";` and `import { InfoTip } from "@/components/ui/info-tip";`.

Replace the entire `{step === 1 && (…)}` block (lines 465–663) with:

```tsx
{step === 1 && (
  <div className="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Basics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="text-sm font-medium">Agent Name *</label>
          <Input
            className="mt-1"
            placeholder="e.g. Recommend Bible Plans"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-medium">Description</label>
          <Input
            className="mt-1"
            placeholder="What does this agent do?"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-1.5">
          Algorithm
          <InfoTip title="Bandit Algorithm">
            How the agent decides which message variant each user gets. Thompson
            Sampling is the right default for most agents.
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={form.algorithm} onValueChange={(v) => update("algorithm", v)}>
          <SelectTrigger className="w-full">
            <span className="flex-1 text-left text-sm truncate">
              {ALGORITHM_OPTIONS.find((a) => a.value === form.algorithm)?.label ?? form.algorithm}
            </span>
          </SelectTrigger>
          <SelectContent>
            {ALGORITHM_OPTIONS.map((algo) => (
              <SelectItem key={algo.value} value={algo.value}>
                <span className="flex items-center gap-2">
                  {algo.label}
                  {algo.badge && (
                    <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium">
                      {algo.badge}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(() => {
          const algo = ALGORITHM_OPTIONS.find((a) => a.value === form.algorithm);
          return algo ? (
            <p className="text-xs text-muted-foreground leading-relaxed">{algo.description}</p>
          ) : null;
        })()}
        {form.algorithm === "epsilon_greedy" && (
          <div>
            <label className="text-sm font-medium">
              Epsilon (exploration rate): {(form.epsilon * 100).toFixed(0)}%
            </label>
            <Slider
              className="mt-2"
              min={0}
              max={0.5}
              step={0.01}
              value={[form.epsilon]}
              onValueChange={(v) => update("epsilon", Array.isArray(v) ? v[0] : v)}
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Percent of sends that explore a random variant instead of exploiting the
              current best performer. Higher = faster learning, more wasted sends.
            </p>
          </div>
        )}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-1.5">
          Targeting
          <InfoTip title="Targeting">
            Target users by funnel stage or by Hightouch audience segments. Excludes
            apply in both modes.
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex rounded-md border overflow-hidden text-sm">
          <button
            type="button"
            className={cn("flex-1 px-3 py-2 font-medium transition-colors",
              !form.segmentMode
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground")}
            onClick={() => update("segmentMode", false)}
          >
            Funnel Stage
          </button>
          <button
            type="button"
            className={cn("flex-1 px-3 py-2 font-medium transition-colors border-l",
              form.segmentMode
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground")}
            onClick={() => update("segmentMode", true)}
          >
            Segment
          </button>
        </div>
        {form.segmentMode ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Include Segments (AND)</label>
            <p className="text-xs text-muted-foreground">User must be in ALL selected segments.</p>
            <SegmentCheckList
              segments={segments}
              selected={form.segmentIncludes}
              currentAgentTargetNames={[]}
              onChange={(v) => update("segmentIncludes", v)}
            />
          </div>
        ) : (
          <div>
            <label className="text-sm font-medium">Funnel Stage *</label>
            <Select
              value={form.funnelStage}
              onValueChange={(v) => update("funnelStage", v as FunnelStage)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select a funnel stage" />
              </SelectTrigger>
              <SelectContent>
                {FUNNEL_STAGES.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {FUNNEL_STAGE_META[stage].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Exclude Segments (optional)</label>
          <p className="text-xs text-muted-foreground">User must NOT be in any selected segment.</p>
          <SegmentCheckList
            segments={segments}
            selected={form.segmentExcludes}
            currentAgentTargetNames={[]}
            onChange={(v) => update("segmentExcludes", v)}
          />
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-1.5">
          Enrollment
          <InfoTip title="Enrollment Mode">
            How users enter and leave this agent&apos;s cohort over time.
          </InfoTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex rounded-md border overflow-hidden text-sm">
          <button
            type="button"
            className={cn("flex-1 px-3 py-2 font-medium transition-colors",
              form.enrollmentMode === "fixed"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground")}
            onClick={() => update("enrollmentMode", "fixed")}
          >
            Fixed Cohort
          </button>
          <button
            type="button"
            className={cn("flex-1 px-3 py-2 font-medium transition-colors border-l",
              form.enrollmentMode === "continuous"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground")}
            onClick={() => update("enrollmentMode", "continuous")}
          >
            Continuous (trigger-based)
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {form.enrollmentMode === "fixed"
            ? "Locks a one-time group of up to your user cap. Users stay until they convert or hit hold limits. Best for one-off campaigns."
            : "Re-checks the segment every run: adds new matches and removes users who leave the segment. Best for always-on, behavior-triggered comms."}
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="text-base">Target Personas</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-2">
          Same segments as <Link href="/personas" className="underline font-medium text-foreground">Personas</Link>.
          Leave empty to target all users.
        </p>
        {personas.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <p>No personas in the database yet.</p>
            <p className="mt-2">
              Add them under <Link href="/personas" className="underline font-medium text-foreground">Personas</Link>
              {" "}or run{" "}
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">npx tsx prisma/seed-personas.ts</code>.
            </p>
          </div>
        ) : (
          <PersonaSelector
            personas={personas}
            selected={form.targetPersonaIds}
            onChange={(ids) => update("targetPersonaIds", ids)}
          />
        )}
      </CardContent>
    </Card>
  </div>
)}
```

Behavioral notes (deliberate, all approved in the spec): "HT Segment" → "Segment"; the Funnel Stage select moved INTO the Targeting card (it used to render below Enrollment); the `<h2>Basic Information</h2>` heading is gone (cards carry their own titles).

- [ ] **Step 5: Run the test to verify it passes**

Run: `TEST_FILES=tests/regression/agent-wizard-validation-hints.test.tsx bun run test:int-reg`
Expected: PASS (2 tests).

- [ ] **Step 6: Quick gate**

Run: `bun run check:quick`
Expected: EXIT 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/agents/agent-wizard.tsx tests/regression/agent-wizard-validation-hints.test.tsx
git commit -m "feat(agents): card-based wizard step 1 with inline validation hints"
```

---

### Task 3: Per-channel message drafts + segmented channel control

Switching channels on the Messages step currently resets `newMsg.variants` to one empty variant (agent-wizard.tsx:773 and :791), silently discarding drafts. Replace the single `newMsg` with a per-channel draft record, and replace the tiny channel `<Select>` with a segmented 3-button control (consistent with the other toggles, and testable in happy-dom where Radix selects are not).

**Files:**
- Modify: `src/components/agents/agent-wizard.tsx`
- Test: `tests/regression/agent-wizard-channel-draft-preservation.test.tsx`

- [ ] **Step 1: Write the failing component test**

`tests/regression/agent-wizard-channel-draft-preservation.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression: switching channels on the wizard Messages step reset the draft
// to a single empty variant, silently discarding typed message name/body.
// Fixed 2026-06-10 by keeping one draft per channel.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AgentWizard } = await import("@/components/agents/agent-wizard");

let container: HTMLDivElement;
let root: Root;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/segments")) {
      return new Response(
        JSON.stringify({ data: [{ name: "VIP", userCount: 1200, assignedTo: null }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    // TemplatePicker fetches (templates/categories) — empty data is fine.
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function typeInto(input: HTMLInputElement, next: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButtonByText(text: string) {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === text,
  )!;
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function goToStep3() {
  act(() => {
    root.render(<AgentWizard personas={[]} />);
  });
  await flush();
  typeInto(
    container.querySelector<HTMLInputElement>('input[placeholder="e.g. Recommend Bible Plans"]')!,
    "My Agent",
  );
  clickButtonByText("Segment");
  const vipRow = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.includes("VIP"),
  )!;
  act(() => {
    vipRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  clickButtonByText("Next"); // -> step 2 (Goals)
  clickButtonByText("Next"); // -> step 3 (Messages)
  await flush();
}

describe("AgentWizard per-channel message drafts", () => {
  it("keeps an email draft intact across a switch to push and back", async () => {
    await goToStep3();

    clickButtonByText("EMAIL");
    typeInto(container.querySelector<HTMLInputElement>('input[placeholder="Message name"]')!, "Welcome email");
    typeInto(container.querySelector<HTMLInputElement>('input[placeholder="Body text"]')!, "Hello there");

    clickButtonByText("PUSH");
    await flush();
    clickButtonByText("EMAIL");
    await flush();

    expect(container.querySelector<HTMLInputElement>('input[placeholder="Message name"]')!.value).toBe("Welcome email");
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Body text"]')!.value).toBe("Hello there");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `TEST_FILES=tests/regression/agent-wizard-channel-draft-preservation.test.tsx bun run test:int-reg`
Expected: FAIL — there are no PUSH/EMAIL buttons yet (channel switching is a Radix Select), so `clickButtonByText("EMAIL")` throws.

- [ ] **Step 3: Implement per-channel drafts**

In `agent-wizard.tsx`, replace the `newMsg` state (lines 306–309) with:

```ts
const makeEmptyDraft = (channel: Channel): MessageDraft => ({
  name: "",
  channel,
  variants: [{ ...emptyVariant(), name: "V1" }],
});
// One draft per channel so switching channels never discards typed work.
const [draftChannel, setDraftChannel] = useState<Channel>("push");
const [drafts, setDrafts] = useState<Record<Channel, MessageDraft>>({
  push: makeEmptyDraft("push"),
  email: makeEmptyDraft("email"),
  sms: makeEmptyDraft("sms"),
});
const newMsg = drafts[draftChannel];
const setNewMsg = (updater: (m: MessageDraft) => MessageDraft) =>
  setDrafts((d) => ({ ...d, [draftChannel]: updater(d[draftChannel]) }));
```

Existing `setNewMsg((m) => …)` call sites keep working unchanged (same updater signature). Update the two that reset state:

- `addMessage` (line 330): replace its reset line with `setDrafts((d) => ({ ...d, [draftChannel]: makeEmptyDraft(draftChannel) }));` (commit `newMsg`, clear only that channel's draft).
- `goNext` step-3 branch (line 356): `newMsg.channel === "push"` still works (the draft's channel field is correct) — no change needed.

- [ ] **Step 4: Replace the channel Select with a segmented control**

In the step-3 JSX, both branches (push at line 773, email/sms at line 791) currently render a `<Select>` whose `onValueChange` resets variants. Replace each with this shared markup (render it once in each branch header, in place of the old Select):

```tsx
<div className="flex rounded-md border overflow-hidden text-xs">
  {CHANNELS.map((c) => (
    <button
      key={c}
      type="button"
      onClick={() => setDraftChannel(c)}
      className={cn(
        "px-3 py-1.5 font-medium transition-colors border-l first:border-l-0",
        draftChannel === c
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {c.toUpperCase()}
    </button>
  ))}
</div>
```

(`toUpperCase()` in JS, not CSS — happy-dom textContent assertions depend on it.)
The branch condition `newMsg.channel === "push"` can stay, or read `draftChannel === "push"` — they're equivalent; use `draftChannel` for clarity.

- [ ] **Step 5: Restyle step 3 wrappers into Cards**

Mechanical wrapper swaps within the `{step === 3 && …}` block:
- `<div className="border rounded-lg p-4 bg-muted/30">` + `<h3 className="text-sm font-medium">Add Push Message</h3>` (push branch) → `<Card>` with `<CardHeader>` containing a flex row: `<CardTitle className="text-base">Add Push Message</CardTitle>` + the segmented channel control; body in `<CardContent>`.
- Same for the email/SMS branch (`Add Message` title).
- Keep the committed-message list rows and convergence-estimate box as they are (they're compact summaries, not form sections).

- [ ] **Step 6: Run the test to verify it passes**

Run: `TEST_FILES=tests/regression/agent-wizard-channel-draft-preservation.test.tsx bun run test:int-reg`
Expected: PASS.
Also re-run: `TEST_FILES=tests/regression/agent-wizard-validation-hints.test.tsx bun run test:int-reg`
Expected: still PASS.

- [ ] **Step 7: Quick gate + commit**

Run: `bun run check:quick` — expected EXIT 0.

```bash
git add src/components/agents/agent-wizard.tsx tests/regression/agent-wizard-channel-draft-preservation.test.tsx
git commit -m "feat(agents): per-channel wizard message drafts + segmented channel control"
```

---

### Task 4: Card restyle of steps 2 and 4

Pure wrapper swaps — no state or logic changes. Every `border rounded-lg p-4` section becomes a `Card` with `CardHeader`/`CardTitle`/`CardContent`.

**Files:**
- Modify: `src/components/agents/agent-wizard.tsx`

- [ ] **Step 1: Step 2 (Goals)**

Replace the preset box wrapper:

```tsx
// OLD
<div className="border rounded-lg p-4 space-y-3 bg-muted/30">
  <h3 className="text-sm font-medium">YouVersion Presets</h3>
  <GoalPresetPicker … />
</div>
// NEW
<Card>
  <CardHeader>
    <CardTitle className="text-base">YouVersion Presets</CardTitle>
  </CardHeader>
  <CardContent>
    <GoalPresetPicker … />
  </CardContent>
</Card>
```

The per-goal rows (`<div key={i} className="border rounded-lg p-3">`) stay — they're list items, not sections.

- [ ] **Step 2: Step 4 (Scheduling) — five sections**

For each of Frequency Cap, Quiet Hours, Quiet Days, Smart Suppression, Max Unique Users, Max Sends Per Day, apply the identical transformation. Worked example (Frequency Cap):

```tsx
// OLD
<div className="border rounded-lg p-4 space-y-3">
  <h3 className="text-sm font-semibold">Frequency Cap</h3>
  {/* …controls… */}
</div>
// NEW
<Card>
  <CardHeader>
    <CardTitle className="text-base">Frequency Cap</CardTitle>
  </CardHeader>
  <CardContent className="space-y-3">
    {/* …controls unchanged… */}
  </CardContent>
</Card>
```

Sections whose `<h3>` has a sibling description `<p>` (Quiet Days, Smart Suppression, Max Unique Users, Max Sends Per Day): move the `<p>` into the `CardHeader` as `<p className="text-xs text-muted-foreground">…</p>` directly under the `CardTitle` (Card's header supports arbitrary children). Smart Suppression's header row keeps its `<Switch>` — put the flex row inside `CardHeader`:

```tsx
<CardHeader>
  <div className="flex items-center justify-between">
    <div>
      <CardTitle className="text-base">Smart Suppression</CardTitle>
      <p className="text-xs text-muted-foreground mt-0.5">
        Only send to users above a predicted conversion threshold
      </p>
    </div>
    <Switch checked={form.smartSuppress} onCheckedChange={(v) => update("smartSuppress", v)} />
  </div>
</CardHeader>
```

Max Unique Users keeps its conditional "(soft ceiling)" suffix inside the `CardTitle` and its mode-dependent description `<p>` in the header. All controls (sliders, selects, custom inputs, "= N users" readouts) move verbatim into `CardContent`.

- [ ] **Step 3: Verify + commit**

Run: `bun run check:quick` — expected EXIT 0.
Run: `TEST_FILES=tests/regression/agent-wizard-validation-hints.test.tsx bun run test:int-reg` — expected PASS (step-1 markup untouched, sanity check).

```bash
git add src/components/agents/agent-wizard.tsx
git commit -m "feat(agents): card-based wizard goals + scheduling steps"
```

---

### Task 5: Review step with Settings-style Rows

Make the launch summary read like the Settings tab's view mode: Cards with label/value `Row`s instead of `Label: value` prose lines.

**Files:**
- Modify: `src/components/agents/agent-wizard.tsx`

- [ ] **Step 1: Add a local Row helper**

Below `StatusAlert` (module scope), add — identical to `Row` in agent-settings-editor.tsx:1140 (6 presentational lines; deliberately duplicated rather than coupling the wizard to the editor's internals):

```tsx
function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4 py-2.5", !last && "border-b")}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{children}</span>
    </div>
  );
}
```

- [ ] **Step 2: Replace the `{step === 5 && …}` block**

```tsx
{step === 5 && (
  <div className="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Basics & Targeting</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Row label="Name">{form.name || "—"}</Row>
        {form.description && <Row label="Description">{form.description}</Row>}
        <Row label="Algorithm">
          {ALGORITHM_OPTIONS.find((a) => a.value === form.algorithm)?.label ?? form.algorithm}
        </Row>
        {form.segmentMode ? (
          <Row label="Include">
            {form.segmentIncludes.length > 0 ? form.segmentIncludes.join(", ") : "—"}
          </Row>
        ) : (
          <Row label="Funnel Stage">
            {form.funnelStage ? FUNNEL_STAGE_META[form.funnelStage as FunnelStage]?.label : "—"}
          </Row>
        )}
        <Row label="Exclude">
          {form.segmentExcludes.length > 0 ? form.segmentExcludes.join(", ") : "—"}
        </Row>
        <Row label="Enrollment" last={form.targetPersonaIds.length === 0}>
          {form.enrollmentMode === "fixed" ? "Fixed Cohort" : "Continuous"}
        </Row>
        {form.targetPersonaIds.length > 0 && (
          <div className="pt-2.5">
            <p className="text-sm text-muted-foreground mb-1.5">Target Personas</p>
            <div className="flex flex-wrap gap-1">
              {form.targetPersonaIds.map((pid) => {
                const persona = personas.find((p) => p.id === pid);
                return persona ? <PersonaBadge key={pid} persona={persona} /> : null;
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="text-base">Goals ({form.goals.length})</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {form.goals.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2.5">None configured</p>
        ) : form.goals.map((g, i) => (
          <Row key={i} label={g.eventName} last={i === form.goals.length - 1}>
            <Badge variant="outline" className="text-xs">{g.tier}</Badge>
          </Row>
        ))}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="text-base">Messages ({form.messages.length})</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {form.messages.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2.5">None configured</p>
        ) : form.messages.map((m, i) => (
          <Row key={i} label={m.name} last={i === form.messages.length - 1}>
            <Badge variant="outline" className="text-xs capitalize">{m.channel}</Badge>
            <span className="ml-1.5 text-muted-foreground">{m.variants.length} variant{m.variants.length === 1 ? "" : "s"}</span>
          </Row>
        ))}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scheduling & Guardrails</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Row label="Frequency Cap">
          Max {form.frequencyCap.maxSends} sends per {form.frequencyCap.period}
        </Row>
        <Row label="Quiet Hours">
          {form.quietStart}–{form.quietEnd} {form.timezone}
        </Row>
        {form.quietDays.length > 0 && (
          <Row label="Quiet Days">
            {form.quietDays
              .sort((a, b) => a - b)
              .map((d) => DAYS_OF_WEEK.find((x) => x.value === d)?.label)
              .join(", ")}
          </Row>
        )}
        <Row label="Max Unique Users">
          {form.uniqueUsersCap !== null ? form.uniqueUsersCap.toLocaleString() : "Unlimited"}
        </Row>
        <Row label="Max Sends Per Day" last>
          {form.dailySendCap !== null ? form.dailySendCap.toLocaleString() : "Unlimited"}
        </Row>
      </CardContent>
    </Card>
  </div>
)}
```

Note: this adds the previously missing "Enrollment" line and always shows "Exclude" (matching the Settings tab's view mode); the smart-suppression setting was never in the old review and stays out (visible on step 4).

- [ ] **Step 3: Verify + commit**

Run: `bun run check:quick` — expected EXIT 0.
Run all three new/updated regression files (one at a time, as before) — expected PASS.

```bash
git add src/components/agents/agent-wizard.tsx
git commit -m "feat(agents): settings-style review step for the agent wizard"
```

---

### Task 6: Full gate + ship

**Files:** none (verification + MR only).

- [ ] **Step 1: Full check**

Run in background with output redirected (zsh pipe-exit trap — check the log, not the shell exit):

```bash
bun run check > /tmp/check-wizard-restyle.log 2>&1; echo "EXIT:$?" >> /tmp/check-wizard-restyle.log
```

Then inspect: `tail -5 /tmp/check-wizard-restyle.log` and `grep -i "fail" /tmp/check-wizard-restyle.log`. Expected: `EXIT:0`, no failures.

- [ ] **Step 2: Push + MR**

```bash
git push -u origin feat/agents-new-wizard-restyle
glab mr create --title "feat: restyle /agents/new wizard to Settings-tab design language" --description "Cards + InfoTip across all 5 steps, shared SegmentCheckList, inline validation hints, per-channel message drafts. Spec: docs/superpowers/specs/2026-06-10-agents-new-wizard-restyle-design.md" --source-branch feat/agents-new-wizard-restyle --target-branch main
```

Merge by MR NUMBER (branch-name merge 405s): `glab mr merge <NUMBER> --remove-source-branch`. Then `git checkout main && git pull`.

---

## Self-review notes

- Spec coverage: §1 visual language → Tasks 2/3/4/5; §2 shared SegmentCheckList → Task 1; §3 validation hints → Task 2; §4 fixes (drafts → Task 3, terminology + epsilon + enrollment explainer → Task 2); §5 tests → Tasks 1/2/3.
- The segmented channel control (Task 3) replaces the spec's implied "keep the Select" — it's required for happy-dom testability and is more consistent with the wizard's other toggles.
- Browser QA against the deployed preview is owed after merge (local dev = prod DB; do not click Save/Launch locally).
