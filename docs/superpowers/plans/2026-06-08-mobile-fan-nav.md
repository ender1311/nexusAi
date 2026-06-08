# Mobile Fan Nav Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the mobile bottom-tab bar access to every subpage via a fan-up popover, while keeping exactly 5 tabs and a single source of nav data.

**Architecture:** Add a derived `mobileTabs` view over the existing `navTree` in `nav-config.ts` (5 tabs: 4 fan groups + the Agents link, with Content libraries + Settings folded into the About fan). Rewrite the `MobileNav` client component in `sidebar.tsx` to render those tabs, where tapping a fan tab opens a vertical pill stack above it behind a dimmed scrim. Active state reuses `activeHref`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, lucide-react, `bun:test` + happy-dom for component tests.

---

## Background for the implementer

`src/components/layout/nav-config.ts` is a pure-data module. It exports `navTree` (an array of `NavEntry`, each either a `NavItem` `{ href, label, icon }` or a `NavGroup` `{ label, icon, children: NavItem[] }`), a type guard `isGroup`, and helpers `flattenItems`, `activeHref(pathname, tree)` (longest-prefix match returning the active leaf href), and `groupLabelForHref`.

`src/components/layout/sidebar.tsx` is `"use client"` and exports two components: `Sidebar` (desktop, `hidden lg:flex`) and `MobileNav` (`fixed bottom-0 … flex lg:hidden`). **Only `MobileNav` changes.** Today `MobileNav` maps over a hardcoded `mobileNavItems` array (lines 204-210) and renders 5 single `<Link>` tabs with no subpage access. We replace that hardcoded array with the new `mobileTabs` data and a fan-up popover interaction.

**happy-dom testing notes (important):**
- The test runner preloads happy-dom via `bunfig.toml` — no manual setup.
- Mock `next/navigation` with `mock.module` BEFORE importing the component, then dynamic-import the component (see `tests/regression/sidebar-nav.test.tsx` for the canonical pattern).
- Responsive utility classes (`lg:hidden`, `lg:flex`) only hide elements via CSS, which happy-dom does NOT evaluate. So if a test renders the whole `Header`/layout it would see both `Sidebar` and `MobileNav` DOM. To avoid double-matching, **render `MobileNav` directly** (in isolation) in the component tests.
- happy-dom does NOT apply CSS `text-transform` to `textContent`. All labels here come from `navTree` already cased correctly, so no JS capitalization is needed — just don't rely on a `capitalize` class for assertions.

---

## File Structure

- **Modify** `src/components/layout/nav-config.ts` — add the mobile-view types (`MobileTab`, `MobileItem`, `MobileDivider`), the `isDivider` guard, the `mobileTabs` derived builder, and helpers `mobileTabLabel` + `activeMobileTabLabel`. Pure data only.
- **Modify** `src/components/layout/sidebar.tsx` — rewrite `MobileNav` to render `mobileTabs` with the fan-up popover; delete the hardcoded `mobileNavItems`; drop now-unused lucide imports.
- **Create** `tests/regression/mobile-fan-nav.test.tsx` — pure-data tests (Task 1) + component tests (Task 2) in one file.

---

## Task 1: Mobile-tabs data model + builder in `nav-config.ts`

**Files:**
- Modify: `src/components/layout/nav-config.ts`
- Test: `tests/regression/mobile-fan-nav.test.tsx` (create)

- [ ] **Step 1: Write the failing tests (pure data)**

Create `tests/regression/mobile-fan-nav.test.tsx` with this content:

```tsx
import { describe, expect, it } from "bun:test";
import {
  navTree,
  flattenItems,
  mobileTabs,
  isDivider,
  mobileTabLabel,
  activeMobileTabLabel,
} from "@/components/layout/nav-config";

// Regression: the mobile bottom nav was a hardcoded 5-item list with no subpage
// access. It is now derived from navTree as `mobileTabs` (a fan-up popover), and
// every navTree page must stay reachable on mobile.

describe("mobileTabs data model", () => {
  it("exposes exactly five tabs in the required order", () => {
    expect(mobileTabs.map(mobileTabLabel)).toEqual([
      "Dashboard",
      "Agents",
      "Audience",
      "Data",
      "About",
    ]);
  });

  it("makes the Agents tab a direct link (no fan)", () => {
    const agents = mobileTabs.find((t) => mobileTabLabel(t) === "Agents");
    expect(agents?.kind).toBe("link");
    if (agents?.kind === "link") expect(agents.item.href).toBe("/agents");
  });

  it("keeps every navTree leaf reachable through some tab", () => {
    const reachable = new Set<string>();
    for (const tab of mobileTabs) {
      if (tab.kind === "link") {
        reachable.add(tab.item.href);
      } else {
        for (const child of tab.children) {
          if (!isDivider(child)) reachable.add(child.href);
        }
      }
    }
    for (const item of flattenItems(navTree)) {
      expect(reachable.has(item.href)).toBe(true);
    }
  });

  it("folds Content libraries + Settings into the About fan after a divider", () => {
    const about = mobileTabs.find((t) => mobileTabLabel(t) === "About");
    expect(about?.kind).toBe("fan");
    if (about?.kind !== "fan") throw new Error("About tab must be a fan");

    const labels = about.children.map((c) => (isDivider(c) ? "---" : c.label));
    expect(labels).toEqual([
      "About",
      "Architecture",
      "Advanced Docs",
      "FAQ",
      "Demo",
      "---",
      "Push Library",
      "Email Library",
      "Verse Library",
      "Settings",
    ]);
  });

  it("resolves the active tab from the pathname", () => {
    expect(activeMobileTabLabel("/")).toBe("Dashboard");
    expect(activeMobileTabLabel("/control-tower")).toBe("Dashboard");
    expect(activeMobileTabLabel("/agents/abc/goals")).toBe("Agents");
    expect(activeMobileTabLabel("/audience/segments")).toBe("Audience");
    expect(activeMobileTabLabel("/settings")).toBe("About");
    expect(activeMobileTabLabel("/messages")).toBe("About");
    expect(activeMobileTabLabel("/personas")).toBe("Data");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/regression/mobile-fan-nav.test.tsx`
Expected: FAIL — `mobileTabs`, `isDivider`, `mobileTabLabel`, `activeMobileTabLabel` are not exported from `nav-config`.

- [ ] **Step 3: Add the types, builder, and helpers to `nav-config.ts`**

Append the following to the END of `src/components/layout/nav-config.ts` (after `groupLabelForHref`). It reuses the existing `navTree`, `isGroup`, `flattenItems`, and `activeHref` — do not redefine nav data:

```ts
// --- Mobile bottom-nav (fan-up popover) view, derived from navTree ---------

export type MobileDivider = { divider: true };
export type MobileItem = NavItem | MobileDivider;
export type MobileTab =
  | { kind: "link"; item: NavItem }
  | { kind: "fan"; label: string; icon: LucideIcon; children: MobileItem[] };

export function isDivider(item: MobileItem): item is MobileDivider {
  return "divider" in item;
}

export function mobileTabLabel(tab: MobileTab): string {
  return tab.kind === "link" ? tab.item.label : tab.label;
}

function groupByLabel(label: string): NavGroup {
  const entry = navTree.find((e) => isGroup(e) && e.label === label);
  if (!entry || !isGroup(entry)) throw new Error(`navTree is missing group "${label}"`);
  return entry;
}

function itemByHref(href: string): NavItem {
  const item = flattenItems(navTree).find((i) => i.href === href);
  if (!item) throw new Error(`navTree is missing item "${href}"`);
  return item;
}

// Five mobile tabs. Four map straight to navTree groups; Agents is a direct
// link. The desktop "Content" group and the standalone Settings item have no
// tab of their own, so they are folded into the About fan (below a divider) to
// keep every page reachable on mobile.
export const mobileTabs: MobileTab[] = [
  { kind: "fan", label: "Dashboard", icon: groupByLabel("Dashboard").icon, children: [...groupByLabel("Dashboard").children] },
  { kind: "link", item: itemByHref("/agents") },
  { kind: "fan", label: "Audience", icon: groupByLabel("Audience").icon, children: [...groupByLabel("Audience").children] },
  { kind: "fan", label: "Data", icon: groupByLabel("Data").icon, children: [...groupByLabel("Data").children] },
  {
    kind: "fan",
    label: "About",
    icon: groupByLabel("About").icon,
    children: [
      ...groupByLabel("About").children,
      { divider: true },
      ...groupByLabel("Content").children,
      itemByHref("/settings"),
    ],
  },
];

export function activeMobileTabLabel(pathname: string): string | undefined {
  const href = activeHref(pathname, navTree);
  if (!href) return undefined;
  for (const tab of mobileTabs) {
    if (tab.kind === "link" && tab.item.href === href) return mobileTabLabel(tab);
    if (tab.kind === "fan" && tab.children.some((c) => !isDivider(c) && c.href === href)) {
      return tab.label;
    }
  }
  return undefined;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/regression/mobile-fan-nav.test.tsx`
Expected: PASS — all 5 `mobileTabs data model` tests green.

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: typecheck clean; lint reports 0 errors (pre-existing warnings are fine).

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/nav-config.ts tests/regression/mobile-fan-nav.test.tsx
git commit -m "feat(nav): derive mobileTabs fan-up view from navTree"
```

---

## Task 2: Fan-up popover `MobileNav` component

**Files:**
- Modify: `src/components/layout/sidebar.tsx` (rewrite `MobileNav`, lines 204-234; adjust imports)
- Test: `tests/regression/mobile-fan-nav.test.tsx` (append component tests)

- [ ] **Step 1: Write the failing component tests**

Append this block to the END of `tests/regression/mobile-fan-nav.test.tsx`:

```tsx
import { afterEach, beforeEach, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

let pathname = "/";
mock.module("next/navigation", () => ({ usePathname: () => pathname }));

const { MobileNav } = await import("@/components/layout/sidebar");
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  pathname = "/";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function tabButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => el.textContent?.includes(label));
}
function pill(label: string): HTMLAnchorElement | undefined {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
    .find((el) => el.textContent?.includes(label));
}

describe("MobileNav fan-up popover", () => {
  it("hides a fan tab's pills until the tab is tapped", () => {
    act(() => root.render(<MobileNav />));
    expect(pill("Search Users")).toBeUndefined();
    act(() => tabButton("Audience")!.click());
    expect(pill("Search Users")).toBeDefined();
    expect(pill("Segments")).toBeDefined();
    expect(pill("Sizes")).toBeDefined();
  });

  it("renders Agents as a direct link with no fan button", () => {
    act(() => root.render(<MobileNav />));
    const agents = pill("Agents");
    expect(agents).toBeDefined();
    expect(agents!.getAttribute("href")).toBe("/agents");
    expect(tabButton("Agents")).toBeUndefined();
  });

  it("exposes Content libraries + Settings inside the About fan", () => {
    act(() => root.render(<MobileNav />));
    act(() => tabButton("About")!.click());
    expect(pill("Push Library")).toBeDefined();
    expect(pill("Email Library")).toBeDefined();
    expect(pill("Verse Library")).toBeDefined();
    expect(pill("Settings")).toBeDefined();
    expect(pill("Architecture")).toBeDefined();
  });

  it("closes an open fan when the scrim is tapped", () => {
    act(() => root.render(<MobileNav />));
    act(() => tabButton("Data")!.click());
    expect(pill("Personas")).toBeDefined();
    const scrim = container.querySelector<HTMLDivElement>('[aria-hidden="true"]');
    expect(scrim).toBeDefined();
    act(() => scrim!.click());
    expect(pill("Personas")).toBeUndefined();
  });

  it("marks the tab active when the route is one of its pages", () => {
    pathname = "/audience/segments";
    act(() => root.render(<MobileNav />));
    expect(tabButton("Audience")!.className).toContain("text-primary");
    expect(tabButton("Data")!.className).not.toContain("text-primary");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/regression/mobile-fan-nav.test.tsx`
Expected: FAIL — `MobileNav` still renders the old hardcoded tabs, so `tabButton("Audience")` is undefined (old tabs are `<Link>`s, not `<button>`s) and the fan pills never appear.

- [ ] **Step 3: Rewrite `MobileNav` and adjust imports in `sidebar.tsx`**

First, update the imports at the top of `src/components/layout/sidebar.tsx`.

Replace the lucide-react import block (lines 5-8):

```tsx
import {
  ChevronLeft, ChevronRight, ChevronDown, Zap,
  LayoutDashboard, Bot, Users2, BookOpen, Sprout,
} from "lucide-react";
```

with (drops the icons that only the deleted `mobileNavItems` used):

```tsx
import { ChevronLeft, ChevronRight, ChevronDown, Zap } from "lucide-react";
```

Replace the react import (line 10):

```tsx
import { useMemo, useState, useSyncExternalStore } from "react";
```

with:

```tsx
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
```

Replace the nav-config import block (lines 13-16):

```tsx
import {
  navTree, isGroup, activeHref, groupLabelForHref,
  type NavItem, type NavGroup,
} from "@/components/layout/nav-config";
```

with:

```tsx
import {
  navTree, isGroup, activeHref, groupLabelForHref,
  mobileTabs, mobileTabLabel, activeMobileTabLabel, isDivider,
  type NavItem, type NavGroup,
} from "@/components/layout/nav-config";
```

Then replace the entire `mobileNavItems` array and `MobileNav` function (current lines 204-234) with:

```tsx
export function MobileNav() {
  const pathname = usePathname();
  const [openTab, setOpenTab] = useState<string | null>(null);
  const active = activeHref(pathname, navTree);
  const activeTab = activeMobileTabLabel(pathname);

  // Route change closes any open fan so it never lingers after navigation.
  useEffect(() => {
    setOpenTab(null);
  }, [pathname]);

  return (
    <>
      {openTab && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setOpenTab(null)}
        />
      )}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex lg:hidden border-t bg-sidebar pb-[env(safe-area-inset-bottom)]">
        {mobileTabs.map((tab) => {
          const label = mobileTabLabel(tab);
          const isActive = label === activeTab;

          if (tab.kind === "link") {
            return (
              <Link
                key={label}
                href={tab.item.href}
                onClick={() => setOpenTab(null)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <tab.item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                <span>{label}</span>
              </Link>
            );
          }

          const open = openTab === label;
          return (
            <div key={label} className="relative flex flex-1">
              {open && (
                <div className="absolute bottom-full left-1/2 z-50 mb-2 flex min-w-[10rem] -translate-x-1/2 flex-col gap-1 rounded-lg border bg-sidebar p-1 shadow-lg">
                  {tab.children.map((child, i) =>
                    isDivider(child) ? (
                      <hr key={`divider-${i}`} className="my-1 border-t" />
                    ) : (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={() => setOpenTab(null)}
                        className={cn(
                          "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          child.href === active
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <child.icon className="h-4 w-4 shrink-0" />
                        <span>{child.label}</span>
                      </Link>
                    ),
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setOpenTab(open ? null : label)}
                aria-expanded={open}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <tab.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                <span>{label}</span>
              </button>
            </div>
          );
        })}
      </nav>
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/regression/mobile-fan-nav.test.tsx`
Expected: PASS — all data tests (Task 1) AND all 5 `MobileNav fan-up popover` tests green.

- [ ] **Step 5: Typecheck + lint**

Run: `bun run typecheck && bun run lint`
Expected: typecheck clean (no unused-import errors for the removed lucide icons); lint 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/sidebar.tsx tests/regression/mobile-fan-nav.test.tsx
git commit -m "feat(nav): fan-up popover mobile bottom nav with subpage access"
```

---

## Task 3: Full check + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the quick check suite**

Run: `bun run check:quick`
Expected: typecheck + lint + unit/contract tests pass (EXIT 0). Note: negative-path tests log `error`-prefixed lines intentionally; only the final pass/fail count matters.

- [ ] **Step 2: Manual UI check (mobile viewport)**

Run: `bun run dev`, open `http://localhost:3000`, set the browser to a mobile viewport (≤1024px wide so `lg:hidden`/`lg:flex` puts the bottom nav on screen). Verify:
- Five tabs: Dashboard, Agents, Audience, Data, About.
- Tapping Audience pops a pill stack (Search Users, Segments, Sizes) above the tab with a dimmed scrim behind.
- Tapping a pill navigates and closes the fan.
- Tapping the scrim closes the fan without navigating.
- Tapping Agents navigates straight to `/agents` (no fan).
- The About fan lists About/Architecture/Advanced Docs/FAQ/Demo, a divider, then Push Library/Email Library/Verse Library/Settings.
- The active tab is highlighted (`text-primary`) for the current route.

State explicitly in your report whether the manual check was performed or skipped.

- [ ] **Step 3: No commit**

This task changes no files. If `bun run check:quick` surfaced an issue, fix it in the relevant task's file and amend that task's commit is NOT allowed — instead make a new fix commit:

```bash
git commit -am "fix(nav): <describe fix>"
```

---

## Self-Review

**1. Spec coverage:**
- 5 tabs, no overflow → Task 1 (`mobileTabs` exactly five) + Task 2 render.
- Every page reachable → Task 1 reachability test.
- Single-source data (no drift) → `mobileTabs` derived from `navTree` via `groupByLabel`/`itemByHref`; Task 1 tests assert structure.
- Tab→group mapping table → Task 1 builder + order test.
- About fan folded catch-all w/ divider → Task 1 fold test + Task 2 About-fan test.
- Fan-up popover + scrim + dismiss-on-navigate + dismiss-on-scrim + route-change close → Task 2 component + scrim test + `useEffect` on pathname.
- Active state via `activeHref` → `activeMobileTabLabel` + Task 2 active test.
- happy-dom regression test → `tests/regression/mobile-fan-nav.test.tsx`.

**2. Placeholder scan:** No TBD/TODO; every code step has full code; every test step has full assertions and exact commands. Clean.

**3. Type consistency:** `MobileTab`/`MobileItem`/`MobileDivider`/`isDivider`/`mobileTabLabel`/`mobileTabs`/`activeMobileTabLabel` are defined in Task 1 and consumed with identical names/signatures in Task 2. The `kind` discriminant (`"link"`/`"fan"`) is used consistently. `activeMobileTabLabel` returns `string | undefined` and is compared to a `string` label (undefined never equals a label → inactive, correct).
