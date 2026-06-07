# Sidebar Navigation Skeleton (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat sidebar with a collapsible, nested navigation tree and add placeholder routes for pages built in sub-projects B/C.

**Architecture:** Extract the nav structure into a pure, typed data module (`nav-config.ts`) with pure helpers for active-route matching and group lookup. Rewrite `sidebar.tsx` to render groups (collapsible) and links from that tree, persisting expanded state to localStorage. Add 4 minimal placeholder Server Component pages.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, lucide-react, bun:test + happy-dom.

---

### Task 1: Pure nav-config module + helpers

**Files:**
- Create: `src/components/layout/nav-config.ts`
- Test: `tests/regression/nav-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/regression/nav-config.test.ts
import { describe, expect, it } from "bun:test";
import { navTree, isGroup, flattenItems, activeHref, groupLabelForHref } from "@/components/layout/nav-config";

describe("nav-config", () => {
  it("keeps every previously-reachable destination", () => {
    const hrefs = flattenItems(navTree).map((i) => i.href);
    for (const required of [
      "/", "/control-tower", "/agents", "/messages", "/push-library",
      "/personas", "/performance", "/data-ingest", "/about", "/architecture",
      "/demo/deep-dive", "/faq", "/demo", "/settings",
    ]) {
      expect(hrefs).toContain(required);
    }
  });

  it("includes the new placeholder routes", () => {
    const hrefs = flattenItems(navTree).map((i) => i.href);
    for (const href of ["/audience/search", "/audience/segments", "/audience/sizes", "/email-library"]) {
      expect(hrefs).toContain(href);
    }
  });

  it("has unique hrefs", () => {
    const hrefs = flattenItems(navTree).map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("matches the most-specific item for a deep route", () => {
    expect(activeHref("/demo/deep-dive/feature-vectors", navTree)).toBe("/demo/deep-dive");
    expect(activeHref("/demo/live", navTree)).toBe("/demo");
    expect(activeHref("/", navTree)).toBe("/");
    expect(activeHref("/agents/abc", navTree)).toBe("/agents");
  });

  it("resolves the parent group label for a child href", () => {
    expect(groupLabelForHref("/control-tower", navTree)).toBe("Dashboard");
    expect(groupLabelForHref("/demo/deep-dive", navTree)).toBe("About");
    expect(groupLabelForHref("/agents", navTree)).toBeUndefined(); // top-level link
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/regression/nav-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/components/layout/nav-config.ts
import {
  LayoutDashboard, Bot, Users2, BarChart3, Settings, Radar, Database,
  Play, Workflow, FlaskConical, Sprout, HelpCircle, BookOpen, Mail,
  ScrollText, Search, Boxes, Ruler, type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { label: string; icon: LucideIcon; children: NavItem[] };
export type NavEntry = NavItem | NavGroup;

export function isGroup(entry: NavEntry): entry is NavGroup {
  return "children" in entry;
}

export const navTree: NavEntry[] = [
  {
    label: "Dashboard", icon: LayoutDashboard, children: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/control-tower", label: "Control Tower", icon: Radar },
    ],
  },
  { href: "/agents", label: "Agents", icon: Bot },
  {
    label: "Audience", icon: Users2, children: [
      { href: "/audience/search", label: "Search Users", icon: Search },
      { href: "/audience/segments", label: "Segments", icon: Boxes },
      { href: "/audience/sizes", label: "Sizes", icon: Ruler },
    ],
  },
  {
    label: "Content", icon: BookOpen, children: [
      { href: "/messages", label: "Push Library", icon: BookOpen },
      { href: "/email-library", label: "Email Library", icon: Mail },
      { href: "/push-library", label: "Verse Library", icon: ScrollText },
    ],
  },
  {
    label: "Data", icon: Database, children: [
      { href: "/personas", label: "Personas", icon: Users2 },
      { href: "/performance", label: "Performance", icon: BarChart3 },
      { href: "/data-ingest", label: "Data Ingest", icon: Database },
    ],
  },
  {
    label: "About", icon: Sprout, children: [
      { href: "/about", label: "About", icon: Sprout },
      { href: "/architecture", label: "Architecture", icon: Workflow },
      { href: "/demo/deep-dive", label: "Advanced Docs", icon: FlaskConical },
      { href: "/faq", label: "FAQ", icon: HelpCircle },
      { href: "/demo", label: "Demo", icon: Play },
    ],
  },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function flattenItems(tree: NavEntry[]): NavItem[] {
  return tree.flatMap((entry) => (isGroup(entry) ? entry.children : [entry]));
}

export function activeHref(pathname: string, tree: NavEntry[]): string | undefined {
  return flattenItems(tree)
    .filter((item) =>
      item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/"),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function groupLabelForHref(href: string | undefined, tree: NavEntry[]): string | undefined {
  if (!href) return undefined;
  for (const entry of tree) {
    if (isGroup(entry) && entry.children.some((c) => c.href === href)) return entry.label;
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/regression/nav-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/nav-config.ts tests/regression/nav-config.test.ts
git commit -m "feat(nav): pure nav-config tree + active-match helpers"
```

---

### Task 2: Rewrite Sidebar to render the nested tree

**Files:**
- Modify: `src/components/layout/sidebar.tsx`
- Test: `tests/regression/sidebar-nav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/regression/sidebar-nav.test.tsx
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

let pathname = "/";
mock.module("next/navigation", () => ({ usePathname: () => pathname }));

const { Sidebar } = await import("@/components/layout/sidebar");
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function groupHeader(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => el.textContent?.includes(label));
}
function link(label: string): HTMLAnchorElement | undefined {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a"))
    .find((el) => el.textContent?.includes(label));
}

describe("Sidebar nested nav", () => {
  it("hides a collapsed group's children until its header is clicked", () => {
    pathname = "/agents";
    act(() => root.render(<Sidebar user={null} />));
    expect(link("Search Users")).toBeUndefined();
    act(() => groupHeader("Audience")!.click());
    expect(link("Search Users")).toBeDefined();
  });

  it("auto-expands the group containing the active route", () => {
    pathname = "/control-tower";
    act(() => root.render(<Sidebar user={null} />));
    expect(link("Control Tower")).toBeDefined();
    const active = link("Control Tower")!;
    expect(active.getAttribute("aria-current")).toBe("page");
  });

  it("highlights the most-specific child for a deep route", () => {
    pathname = "/demo/deep-dive/feature-vectors";
    act(() => root.render(<Sidebar user={null} />));
    expect(link("Advanced Docs")!.getAttribute("aria-current")).toBe("page");
    expect(link("Demo")!.getAttribute("aria-current")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/regression/sidebar-nav.test.tsx`
Expected: FAIL — Sidebar still flat; "Search Users" never appears / no group headers.

- [ ] **Step 3: Rewrite `sidebar.tsx`**

Replace the file with the version below. Keeps `SidebarUser`, full-rail collapse, footer (theme/user/sign-out) intact; swaps the flat `navItems` for `navTree` rendering with collapsible groups. Updates `MobileNav` to use explicit destinations.

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronDown, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import {
  navTree, isGroup, activeHref, groupLabelForHref,
  type NavItem, type NavGroup,
} from "@/components/layout/nav-config";

type SidebarUser = { email: string; firstName: string | null; lastName: string | null };

const EXPANDED_KEY = "nexus.nav.expanded";

export function Sidebar({ user }: { user: SidebarUser | null }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const active = activeHref(pathname, navTree);
  const activeGroup = groupLabelForHref(active, navTree);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let stored: Record<string, boolean> = {};
    try {
      stored = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "{}");
    } catch {
      stored = {};
    }
    setExpanded(stored);
  }, []);

  function toggleGroup(label: string) {
    setExpanded((prev) => {
      const next = { ...prev, [label]: !isExpanded(label, prev) };
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }
  // A group is open if explicitly toggled open, OR it contains the active route
  // and hasn't been explicitly closed.
  function isExpanded(label: string, state = expanded): boolean {
    if (label in state) return state[label];
    return label === activeGroup;
  }

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
    : null;
  const initials = user ? (user.firstName?.[0] ?? user.email[0]).toUpperCase() : "?";

  function renderLink(item: NavItem, nested: boolean) {
    const isActive = item.href === active;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
          nested && !collapsed && "ml-4",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  }

  function renderGroup(group: NavGroup) {
    const open = isExpanded(group.label);
    const hasActive = group.label === activeGroup;
    if (collapsed) {
      // Rail mode: a single icon that navigates to the group's first child.
      const first = group.children[0];
      return (
        <Link
          key={group.label}
          href={first.href}
          title={group.label}
          aria-current={hasActive ? "page" : undefined}
          className={cn(
            "flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            hasActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <group.icon className="h-4 w-4 shrink-0" />
        </Link>
      );
    }
    return (
      <div key={group.label}>
        <button
          type="button"
          onClick={() => toggleGroup(group.label)}
          aria-expanded={open}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            hasActive && !open
              ? "text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <group.icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{group.label}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")} />
        </button>
        {open && <div className="mt-1 space-y-1">{group.children.map((c) => renderLink(c, true))}</div>}
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col border-r bg-sidebar transition-all duration-300 shrink-0",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className="flex items-center justify-between h-16 px-4 border-b">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Nexus</span>
          </div>
        )}
        {collapsed && <Zap className="h-5 w-5 text-primary mx-auto" />}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="p-1 rounded-md hover:bg-muted text-muted-foreground ml-auto"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {navTree.map((entry) => (isGroup(entry) ? renderGroup(entry) : renderLink(entry, false)))}
      </nav>

      <div className="border-t px-3 py-2.5">
        <ThemeToggle collapsed={collapsed} />
      </div>

      <div className="border-t p-2">
        {!collapsed && user && (
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
        )}
        {collapsed && user && (
          <div className="flex justify-center py-2 mb-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              {initials}
            </div>
          </div>
        )}
        <SignOutButton collapsed={collapsed} />
      </div>
    </aside>
  );
}

import { LayoutDashboard, Bot, Users2, BookOpen, Sprout } from "lucide-react";

const mobileNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/audience/search", label: "Audience", icon: Users2 },
  { href: "/messages", label: "Content", icon: BookOpen },
  { href: "/about", label: "About", icon: Sprout },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex lg:hidden border-t bg-sidebar pb-[env(safe-area-inset-bottom)]">
      {mobileNavItems.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <item.icon className={cn("h-5 w-5", active && "text-primary")} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/regression/sidebar-nav.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/sidebar.tsx tests/regression/sidebar-nav.test.tsx
git commit -m "feat(nav): collapsible nested sidebar rendering navTree"
```

---

### Task 3: Placeholder pages for unbuilt routes

**Files:**
- Create: `src/components/layout/coming-soon.tsx`
- Create: `src/app/audience/search/page.tsx`
- Create: `src/app/audience/segments/page.tsx`
- Create: `src/app/audience/sizes/page.tsx`
- Create: `src/app/email-library/page.tsx`
- Test: `tests/regression/placeholder-pages.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/regression/placeholder-pages.test.tsx
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SearchPage from "@/app/audience/search/page";
import SegmentsPage from "@/app/audience/segments/page";
import SizesPage from "@/app/audience/sizes/page";
import EmailLibraryPage from "@/app/email-library/page";

describe("placeholder pages", () => {
  it("each renders a Coming soon heading without throwing", () => {
    for (const Page of [SearchPage, SegmentsPage, SizesPage, EmailLibraryPage]) {
      const html = renderToStaticMarkup(<Page />);
      expect(html).toContain("Coming soon");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/regression/placeholder-pages.test.tsx`
Expected: FAIL — page modules not found.

- [ ] **Step 3: Create the shared placeholder + pages**

```tsx
// src/components/layout/coming-soon.tsx
import { Header } from "@/components/layout/header";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <>
      <Header title={title} description={description} />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-xl border bg-card px-8 py-10 text-center max-w-md">
          <p className="text-sm font-semibold text-muted-foreground">Coming soon</p>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </>
  );
}
```

```tsx
// src/app/audience/search/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon title="Search Users" description="Look up an individual user and see all their data and messaging history." />;
}
```

```tsx
// src/app/audience/segments/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon title="Segments" description="Build audience segments from your data fields and size them against the database." />;
}
```

```tsx
// src/app/audience/sizes/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon title="Sizes" description="Estimated and exact sizes for every audience you've built or imported from Hightouch." />;
}
```

```tsx
// src/app/email-library/page.tsx
import { ComingSoon } from "@/components/layout/coming-soon";
export default function Page() {
  return <ComingSoon title="Email Library" description="Email message templates and variants." />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/regression/placeholder-pages.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/coming-soon.tsx src/app/audience src/app/email-library tests/regression/placeholder-pages.test.tsx
git commit -m "feat(nav): placeholder pages for Audience + Email Library"
```

---

### Task 4: Update RoutePreloader (optional polish)

**Files:**
- Modify: `src/components/layout/route-preloader.tsx`

- [ ] **Step 1: Add prefetch for the new top destinations** — append `router.prefetch("/audience/search");` to the existing prefetch list. No new test (prefetch is a perf hint).

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/route-preloader.tsx
git commit -m "chore(nav): prefetch audience search route"
```

---

### Final verification

- [ ] Run `bun run check:quick` (typecheck + lint + unit/contract) — expect EXIT 0.
- [ ] Run `bun run check` (full suite incl. regression) before MR — expect EXIT 0.
- [ ] Manual: `bun run dev`, confirm groups expand/collapse, active route highlights + parent auto-expands, rail-collapse still works, every old page still reachable, placeholders render.
- [ ] Push branch, `glab mr create`, poll `detailed_merge_status` until `mergeable`, `glab mr merge`.
