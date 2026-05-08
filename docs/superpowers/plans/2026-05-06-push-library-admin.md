# Push Library Admin Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/push-library` page where all authenticated users browse push copy templates, and admins (WorkOS `admin` role) can create, edit, and delete them.

**Architecture:** Three new API routes (`GET/POST /api/push-library`, `DELETE /api/push-library/[id]`) back a Server-Component page that queries the `__push-copy-library__` agent's variants. The page passes an `isAdmin` boolean down to three client components (card, form sheet, delete dialog). Edits go through the existing `PATCH /api/variants/[id]` which already syncs clones. Deletes soft-archive the variant (status → "archived").

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7 + Neon, shadcn/ui (Sheet, AlertDialog, Badge, Card), WorkOS AuthKit v4 (`withAuth()` returns `roles?: string[]`), `PushNotificationPreview` (existing component at `src/components/agents/push-notification-preview.tsx`), Bun test runner with `mock.module`.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/lib/auth.ts` | Add `getAuth()` — returns `{ user, isAdmin }` using `withAuth().roles` |
| Create | `src/app/api/push-library/route.ts` | `GET` (grouped variants) + `POST` (create, admin only) |
| Create | `src/app/api/push-library/[id]/route.ts` | `DELETE` (soft-archive, admin only) |
| Modify | `src/components/layout/sidebar.tsx` | Add "Push Library" nav item between Messages and Personas |
| Create | `src/app/push-library/page.tsx` | Server Component; reads DB directly, passes `isAdmin` to client |
| Create | `src/app/push-library/loading.tsx` | Skeleton loader |
| Create | `src/components/push-library/template-card.tsx` | Card: preview + name + subcategory badge + deeplink + edit/delete |
| Create | `src/components/push-library/delete-confirm-dialog.tsx` | AlertDialog wrapper |
| Create | `src/components/push-library/template-form-sheet.tsx` | Sheet drawer for create/edit |
| Create | `tests/integration/push-library.test.ts` | API integration tests |

---

## Task 1: Add `getAuth()` to auth helper

**Files:**
- Modify: `src/lib/auth.ts`

The WorkOS `withAuth()` returns `{ user, roles?: string[], ... }`. Currently `auth.ts` only exposes `getSessionUser()` (no roles). We add `getAuth()` so all push-library code has one import for user + admin flag.

- [ ] **Step 1: Edit `src/lib/auth.ts`**

```ts
import { withAuth, signOut } from "@workos-inc/authkit-nextjs";

export { signOut };

const ALLOWED_DOMAINS = ["@youversion.com", "@life.church"] as const;

export function isAllowedDomain(email?: string | null): boolean {
  const lower = email?.toLowerCase();
  return Boolean(lower && ALLOWED_DOMAINS.some((d) => lower.endsWith(d)));
}

export async function getSessionUser() {
  const { user } = await withAuth();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
  };
}

/** Returns session user + admin flag in one call. */
export async function getAuth(): Promise<{
  user: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
  isAdmin: boolean;
}> {
  const auth = await withAuth();
  const user = auth.user
    ? {
        id: auth.user.id,
        email: auth.user.email,
        firstName: auth.user.firstName ?? null,
        lastName: auth.user.lastName ?? null,
      }
    : null;
  return { user, isAdmin: auth.roles?.includes("admin") ?? false };
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git checkout -b feat/push-library
git add src/lib/auth.ts
git commit -m "feat: add getAuth() helper with isAdmin flag from WorkOS roles"
```

---

## Task 2: Integration tests (TDD — write all failing first)

**Files:**
- Create: `tests/integration/push-library.test.ts`

Write all six integration tests now so they fail. We'll make them pass in Tasks 3–5.

The test file mocks `@workos-inc/authkit-nextjs` with a mutable `mockRoles` object so individual tests can flip between admin and non-admin.

- [ ] **Step 1: Create `tests/integration/push-library.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { buildRequest } from "../helpers/request";

// Mutable auth state — mutate before each test that needs a specific role
const mockAuth: { roles: string[] } = { roles: [] };

mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: { id: "u1", email: "test@youversion.com", firstName: null, lastName: null },
      roles: mockAuth.roles,
      sessionId: "sess1",
      accessToken: "tok1",
    }),
  signOut: async () => {},
}));

// Import AFTER mock.module so the mock takes effect
const { GET, POST } = await import("@/app/api/push-library/route");
const { DELETE } = await import("@/app/api/push-library/[id]/route");

const LIBRARY_AGENT_NAME = "__push-copy-library__";

beforeEach(async () => {
  await truncateAll();
  mockAuth.roles = [];
});
afterEach(async () => {
  await truncateAll();
});

// Helper: seed a minimal library agent with one variant
async function seedLibrary() {
  const agent = await createAgent({ name: LIBRARY_AGENT_NAME, status: "draft" });
  const msg = await createMessage(agent.id);
  const variant = await createVariant(msg.id, {
    name: "Open Bible",
    title: "Build your Bible habit!",
    body: "Build your Bible habit today.",
    deeplink: "youversion://bible",
    category: "reader",
    subcategory: "open-bible",
    status: "active",
  });
  return { agent, msg, variant };
}

describe("GET /api/push-library", () => {
  it("returns grouped variants for authenticated user", async () => {
    await seedLibrary();
    const req = buildRequest("GET") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("category");
    expect(body.data[0]).toHaveProperty("variants");
    expect(body.data[0].variants[0]).toHaveProperty("id");
    expect(body.data[0].variants[0]).toHaveProperty("name");
    expect(body.data[0].variants[0]).toHaveProperty("body");
  });

  it("excludes archived variants", async () => {
    const agent = await createAgent({ name: LIBRARY_AGENT_NAME, status: "draft" });
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, {
      name: "Active",
      body: "active body",
      category: "reader",
      status: "active",
    });
    await createVariant(msg.id, {
      name: "Archived",
      body: "archived body",
      category: "reader",
      status: "archived",
    });

    const req = buildRequest("GET") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    const names = body.data.flatMap((g: { variants: { name: string }[] }) =>
      g.variants.map((v: { name: string }) => v.name)
    );
    expect(names).toContain("Active");
    expect(names).not.toContain("Archived");
  });
});

describe("POST /api/push-library", () => {
  it("returns 403 for non-admin", async () => {
    mockAuth.roles = [];
    await seedLibrary();

    const req = buildRequest("POST", {
      name: "New Template",
      category: "reader",
      subcategory: "open-bible",
      body: "Test body",
    }) as NextRequest;
    const res = await POST(req);

    expect(res.status).toBe(403);
  });

  it("creates variant under library agent for admin", async () => {
    mockAuth.roles = ["admin"];
    await seedLibrary();

    const req = buildRequest("POST", {
      name: "New Reminder",
      category: "reader",
      subcategory: "open-bible",
      title: "Read today",
      body: "Spend time with God.",
      deeplink: "youversion://bible",
      cta: "Open Bible App",
    }) as NextRequest;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toHaveProperty("id");
    expect(body.data.name).toBe("New Reminder");
    expect(body.data.category).toBe("reader");
    expect(body.data.subcategory).toBe("open-bible");

    // Verify it appears in GET
    const getReq = buildRequest("GET") as NextRequest;
    const getRes = await GET(getReq);
    const getBody = await getRes.json();
    const allNames = getBody.data.flatMap((g: { variants: { name: string }[] }) =>
      g.variants.map((v: { name: string }) => v.name)
    );
    expect(allNames).toContain("New Reminder");
  });

  it("returns 400 when body is missing", async () => {
    mockAuth.roles = ["admin"];
    await seedLibrary();

    const req = buildRequest("POST", {
      name: "Missing body",
      category: "reader",
    }) as NextRequest;
    const res = await POST(req);

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/push-library/[id]", () => {
  it("returns 403 for non-admin", async () => {
    mockAuth.roles = [];
    const { variant } = await seedLibrary();

    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: variant.id }) });

    expect(res.status).toBe(403);
  });

  it("archives variant for admin and removes from GET", async () => {
    mockAuth.roles = ["admin"];
    const { variant } = await seedLibrary();

    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: variant.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(variant.id);

    // Verify archived in DB
    const inDb = await prisma.messageVariant.findUnique({ where: { id: variant.id } });
    expect(inDb!.status).toBe("archived");

    // Verify excluded from GET
    const getReq = buildRequest("GET") as NextRequest;
    const getRes = await GET(getReq);
    const getBody = await getRes.json();
    const allIds = getBody.data.flatMap((g: { variants: { id: string }[] }) =>
      g.variants.map((v: { id: string }) => v.id)
    );
    expect(allIds).not.toContain(variant.id);
  });

  it("returns 404 for unknown variant", async () => {
    mockAuth.roles = ["admin"];

    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: "nonexistent" }) });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun run test tests/integration/push-library.test.ts
```

Expected: all tests fail with "Cannot find module" or similar — routes don't exist yet.

---

## Task 3: GET + POST `/api/push-library`

**Files:**
- Create: `src/app/api/push-library/route.ts`

- [ ] **Step 1: Create `src/app/api/push-library/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";

const VALID_CATEGORIES = new Set([
  "reader", "plans", "votd", "guided-scripture", "guided-prayer",
]);

export async function GET(_req: NextRequest) {
  try {
    const agent = await prisma.agent.findFirst({
      where: { name: LIBRARY_AGENT_NAME },
    });
    if (!agent) {
      return NextResponse.json({ data: [] });
    }

    const variants = await prisma.messageVariant.findMany({
      where: { message: { agentId: agent.id }, status: "active" },
      select: {
        id: true,
        name: true,
        title: true,
        body: true,
        deeplink: true,
        cta: true,
        category: true,
        subcategory: true,
      },
      orderBy: [{ category: "asc" }, { subcategory: "asc" }, { createdAt: "asc" }],
    });

    // Group by category, then subcategory within each group
    const grouped = new Map<string, Map<string | null, typeof variants>>();
    for (const v of variants) {
      const cat = v.category ?? "uncategorized";
      if (!grouped.has(cat)) grouped.set(cat, new Map());
      const subMap = grouped.get(cat)!;
      const sub = v.subcategory ?? null;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push(v);
    }

    const data = Array.from(grouped.entries()).flatMap(([category, subMap]) =>
      Array.from(subMap.entries()).map(([subcategory, vs]) => ({
        category,
        subcategory,
        variants: vs,
      }))
    );

    return NextResponse.json({ data });
  } catch (error) {
    console.error("GET /api/push-library error:", error);
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { isAdmin } = await getAuth();
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, category, subcategory, title, body: msgBody, deeplink, cta } = body as {
    name?: unknown;
    category?: unknown;
    subcategory?: unknown;
    title?: unknown;
    body?: unknown;
    deeplink?: unknown;
    cta?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof category !== "string" || !VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (typeof msgBody !== "string" || msgBody.trim() === "") {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  try {
    // Find or create library agent
    let agent = await prisma.agent.findFirst({ where: { name: LIBRARY_AGENT_NAME } });
    if (!agent) {
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
    }

    // Find existing message for this category, or create one
    let message = await prisma.message.findFirst({
      where: { agentId: agent.id, variants: { some: { category } } },
    });
    if (!message) {
      message = await prisma.message.create({
        data: {
          agentId: agent.id,
          name: `${category} Templates`,
          channel: "push",
        },
      });
    }

    const variant = await prisma.messageVariant.create({
      data: {
        messageId: message.id,
        name: name.trim(),
        title: typeof title === "string" ? title.trim() || null : null,
        body: msgBody.trim(),
        deeplink: typeof deeplink === "string" ? deeplink.trim() || null : null,
        cta: typeof cta === "string" ? cta.trim() || null : null,
        category,
        subcategory: typeof subcategory === "string" ? subcategory.trim() || null : null,
        status: "active",
      },
    });

    return NextResponse.json({ data: variant }, { status: 201 });
  } catch (error) {
    console.error("POST /api/push-library error:", error);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run GET and POST tests**

```bash
bun run test tests/integration/push-library.test.ts --test-name-pattern "GET|POST"
```

Expected: GET tests and POST tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/push-library/route.ts
git commit -m "feat: GET + POST /api/push-library with admin guard"
```

---

## Task 4: DELETE `/api/push-library/[id]`

**Files:**
- Create: `src/app/api/push-library/[id]/route.ts`

- [ ] **Step 1: Create `src/app/api/push-library/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin } = await getAuth();
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const variant = await prisma.messageVariant.findUnique({
    where: { id },
    include: { message: { include: { agent: { select: { name: true } } } } },
  });

  if (!variant) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  if (variant.message.agent.name !== LIBRARY_AGENT_NAME) {
    return NextResponse.json({ error: "Not a library template" }, { status: 400 });
  }

  await prisma.messageVariant.update({
    where: { id },
    data: { status: "archived" },
  });

  return NextResponse.json({ data: { id } });
}
```

- [ ] **Step 2: Run full test suite**

```bash
bun run test tests/integration/push-library.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/push-library/[id]/route.ts
git commit -m "feat: DELETE /api/push-library/[id] soft-archives template"
```

---

## Task 5: Sidebar nav item

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

Add "Push Library" between "Messages" and "Personas" in `navItems`. Import `BookOpen` from lucide-react.

- [ ] **Step 1: Edit `src/components/layout/sidebar.tsx`**

Change the import line at the top from:
```ts
import {
  LayoutDashboard,
  Bot,
  MessageSquare,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  Users2,
  PlayCircle,
  Radar,
  Sprout,
} from "lucide-react";
```

To:
```ts
import {
  LayoutDashboard,
  Bot,
  MessageSquare,
  BookOpen,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  Users2,
  PlayCircle,
  Radar,
  Sprout,
} from "lucide-react";
```

Change the `navItems` array from:
```ts
const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/personas", label: "Personas", icon: Users2 },
  ...
```

To:
```ts
const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/push-library", label: "Push Library", icon: BookOpen },
  { href: "/personas", label: "Personas", icon: Users2 },
  ...
```

- [ ] **Step 2: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: add Push Library nav item to sidebar"
```

---

## Task 6: Page + loading skeleton

**Files:**
- Create: `src/app/push-library/page.tsx`
- Create: `src/app/push-library/loading.tsx`

The page is a Server Component. It reads templates directly from Prisma (no fetch), extracts `isAdmin` from WorkOS roles, and passes both down to client components.

The grouped data type used throughout:
```ts
type TemplateGroup = {
  category: string;
  subcategory: string | null;
  variants: TemplateVariant[];
};

type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
};
```

- [ ] **Step 1: Create `src/app/push-library/loading.tsx`**

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((j) => (
              <Skeleton key={j} className="h-48 rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/push-library/page.tsx`**

```tsx
export const dynamic = "force-dynamic";

import { BookOpen } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";
import { TemplateCard } from "@/components/push-library/template-card";
import { TemplateFormSheet } from "@/components/push-library/template-form-sheet";

type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
};

type TemplateGroup = {
  category: string;
  subcategory: string | null;
  variants: TemplateVariant[];
};

async function getGroups(): Promise<TemplateGroup[]> {
  const agent = await prisma.agent.findFirst({
    where: { name: LIBRARY_AGENT_NAME },
  });
  if (!agent) return [];

  const variants = await prisma.messageVariant.findMany({
    where: { message: { agentId: agent.id }, status: "active" },
    select: {
      id: true,
      name: true,
      title: true,
      body: true,
      deeplink: true,
      cta: true,
      category: true,
      subcategory: true,
    },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { createdAt: "asc" }],
  });

  const grouped = new Map<string, Map<string | null, TemplateVariant[]>>();
  for (const v of variants) {
    const cat = v.category ?? "uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, new Map());
    const subMap = grouped.get(cat)!;
    const sub = v.subcategory ?? null;
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub)!.push(v);
  }

  return Array.from(grouped.entries()).flatMap(([category, subMap]) =>
    Array.from(subMap.entries()).map(([subcategory, vs]) => ({
      category,
      subcategory,
      variants: vs,
    }))
  );
}

export default async function PushLibraryPage() {
  const { isAdmin } = await getAuth();
  const groups = await getGroups();

  const totalVariants = groups.reduce((s, g) => s + g.variants.length, 0);
  const description = `${totalVariants} template${totalVariants !== 1 ? "s" : ""} across ${groups.length} group${groups.length !== 1 ? "s" : ""}`;

  return (
    <>
      <Header
        title="Push Library"
        description={description}
        actions={
          isAdmin ? (
            <TemplateFormSheet mode="create">
              <Button size="sm">+ New Template</Button>
            </TemplateFormSheet>
          ) : null
        }
      />
      <div className="p-4 sm:p-6 space-y-6">
        {groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No templates yet</p>
            <p className="text-sm mt-1">Run the seed script to populate the library.</p>
          </div>
        )}
        {groups.map((group) => {
          const sectionKey = `${group.category}-${group.subcategory ?? "none"}`;
          const sectionLabel = group.subcategory
            ? `${group.category} / ${group.subcategory}`
            : group.category;
          return (
            <section key={sectionKey}>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                {sectionLabel}
                <Badge variant="secondary" className="ml-1">
                  {group.variants.length}
                </Badge>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.variants.map((v) => (
                  <TemplateCard key={v.id} variant={v} isAdmin={isAdmin} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verify typecheck (will fail — components don't exist yet; that's fine)**

Note the typecheck will fail because `TemplateCard` and `TemplateFormSheet` don't exist yet. That's expected at this stage.

- [ ] **Step 4: Commit (partial — components wired in next tasks)**

```bash
git add src/app/push-library/page.tsx src/app/push-library/loading.tsx
git commit -m "feat: push-library page and loading skeleton"
```

---

## Task 7: TemplateCard component

**Files:**
- Create: `src/components/push-library/template-card.tsx`

A client component (needs delete/edit handlers). Shows push preview, name, subcategory badge, truncated deeplink, and admin-only Edit + Delete buttons.

- [ ] **Step 1: Create `src/components/push-library/template-card.tsx`**

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { PushNotificationPreview } from "@/components/agents/push-notification-preview";
import { TemplateFormSheet } from "@/components/push-library/template-form-sheet";
import { DeleteConfirmDialog } from "@/components/push-library/delete-confirm-dialog";

type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
};

interface TemplateCardProps {
  variant: TemplateVariant;
  isAdmin: boolean;
}

export function TemplateCard({ variant, isAdmin }: TemplateCardProps) {
  const truncatedDeeplink =
    variant.deeplink && variant.deeplink.length > 50
      ? `${variant.deeplink.slice(0, 47)}…`
      : variant.deeplink;

  return (
    <Card className="flex flex-col overflow-hidden">
      <CardContent className="flex-1 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{variant.name}</p>
          {variant.subcategory && (
            <Badge variant="outline" className="shrink-0 text-xs">
              {variant.subcategory}
            </Badge>
          )}
        </div>
        <PushNotificationPreview
          title={variant.title}
          body={variant.body}
          deeplink={variant.deeplink}
        />
        {truncatedDeeplink && (
          <p className="text-xs font-mono text-muted-foreground break-all">
            {truncatedDeeplink}
          </p>
        )}
      </CardContent>
      {isAdmin && (
        <CardFooter className="px-4 pb-4 pt-0 flex gap-2">
          <TemplateFormSheet mode="edit" variant={variant}>
            <Button variant="outline" size="sm" className="flex-1">
              Edit
            </Button>
          </TemplateFormSheet>
          <DeleteConfirmDialog variantId={variant.id} variantName={variant.name}>
            <Button variant="outline" size="sm" className="flex-1 text-destructive hover:text-destructive">
              Delete
            </Button>
          </DeleteConfirmDialog>
        </CardFooter>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Verify it compiles (typecheck will still fail until Sheet + Dialog are done)**

```bash
bun run typecheck 2>&1 | grep "push-library"
```

Expected: errors in template-card.tsx about missing imports — that's fine for now.

- [ ] **Step 3: Commit**

```bash
git add src/components/push-library/template-card.tsx
git commit -m "feat: TemplateCard component with push preview and admin controls"
```

---

## Task 8: DeleteConfirmDialog component

**Files:**
- Create: `src/components/push-library/delete-confirm-dialog.tsx`

shadcn AlertDialog that fires `DELETE /api/push-library/[id]` then calls `router.refresh()`.

- [ ] **Step 1: Ensure AlertDialog is installed**

```bash
npx shadcn add alert-dialog 2>/dev/null || true
```

If already installed, this is a no-op.

- [ ] **Step 2: Create `src/components/push-library/delete-confirm-dialog.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface DeleteConfirmDialogProps {
  variantId: string;
  variantName: string;
  children: React.ReactNode;
}

export function DeleteConfirmDialog({
  variantId,
  variantName,
  children,
}: DeleteConfirmDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    try {
      await fetch(`/api/push-library/${variantId}`, { method: "DELETE" });
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete template?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{variantName}</strong> will be archived. Agents that cloned this
            template keep their current copy; the nightly sync will no longer update them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/push-library/delete-confirm-dialog.tsx
git commit -m "feat: DeleteConfirmDialog for soft-archiving library templates"
```

---

## Task 9: TemplateFormSheet component

**Files:**
- Create: `src/components/push-library/template-form-sheet.tsx`

Sheet drawer for create/edit. Live `PushNotificationPreview` updates as title/body change.

On submit:
- **Create**: `POST /api/push-library`
- **Edit**: `PATCH /api/variants/[id]` (existing route, syncs clones)

Both call `router.refresh()` after success.

- [ ] **Step 1: Ensure Sheet is installed**

```bash
npx shadcn add sheet 2>/dev/null || true
```

- [ ] **Step 2: Create `src/components/push-library/template-form-sheet.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PushNotificationPreview } from "@/components/agents/push-notification-preview";

const CATEGORIES = [
  "reader",
  "plans",
  "votd",
  "guided-scripture",
  "guided-prayer",
] as const;

const SUBCATEGORIES: Record<string, string[]> = {
  reader: ["open-bible", "audio-bible", "specific-verse"],
  plans: ["find-plans", "my-plans", "saved-plans"],
  votd: ["votd-page", "todays-story"],
  "guided-scripture": [],
  "guided-prayer": ["guided-prayer", "prayer-list"],
};

type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
};

type Props =
  | { mode: "create"; variant?: undefined; children: React.ReactNode }
  | { mode: "edit"; variant: TemplateVariant; children: React.ReactNode };

export function TemplateFormSheet({ mode, variant, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState(variant?.name ?? "");
  const [category, setCategory] = useState(variant?.category ?? "");
  const [subcategory, setSubcategory] = useState(variant?.subcategory ?? "");
  const [title, setTitle] = useState(variant?.title ?? "");
  const [body, setBody] = useState(variant?.body ?? "");
  const [deeplink, setDeeplink] = useState(variant?.deeplink ?? "");
  const [cta, setCta] = useState(variant?.cta ?? "");

  const subcategoryOptions = SUBCATEGORIES[category] ?? [];

  function resetForm() {
    if (mode === "create") {
      setName("");
      setCategory("");
      setSubcategory("");
      setTitle("");
      setBody("");
      setDeeplink("");
      setCta("");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "create") {
        await fetch("/api/push-library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            category,
            subcategory: subcategory || undefined,
            title: title || undefined,
            body,
            deeplink: deeplink || undefined,
            cta: cta || undefined,
          }),
        });
      } else {
        await fetch(`/api/variants/${variant.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            title: title || null,
            body,
            deeplink: deeplink || null,
            cta: cta || null,
            category,
          }),
        });
      }
      setOpen(false);
      resetForm();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {mode === "create" ? "New Template" : "Edit Template"}
          </SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. A — Consistency"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v);
                setSubcategory("");
              }}
            >
              <SelectTrigger id="category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {subcategoryOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="subcategory">Subcategory</Label>
              <Select value={subcategory} onValueChange={setSubcategory}>
                <SelectTrigger id="subcategory">
                  <SelectValue placeholder="Select subcategory" />
                </SelectTrigger>
                <SelectContent>
                  {subcategoryOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Push notification title"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">Body</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Push body copy"
              rows={3}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deeplink">Deeplink</Label>
            <Input
              id="deeplink"
              value={deeplink}
              onChange={(e) => setDeeplink(e.target.value)}
              placeholder="youversion://bible or https://..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cta">CTA (optional)</Label>
            <Input
              id="cta"
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              placeholder="Button label"
            />
          </div>

          {/* Live preview */}
          <div className="space-y-1.5">
            <Label>Preview</Label>
            <PushNotificationPreview
              title={title || undefined}
              body={body || "Your message body will appear here."}
              deeplink={deeplink || undefined}
            />
          </div>

          <SheetFooter>
            <Button type="submit" disabled={loading} className="w-full">
              {loading
                ? mode === "create"
                  ? "Creating…"
                  : "Saving…"
                : mode === "create"
                ? "Create Template"
                : "Save Changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Run typecheck to confirm everything wires up**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run full integration test suite**

```bash
bun run test tests/integration/push-library.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Run full check**

```bash
bun run check
```

Expected: lint + typecheck pass, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/push-library/template-form-sheet.tsx
git commit -m "feat: TemplateFormSheet with live preview for create/edit"
```

---

## Task 10: Final check + push + MR

- [ ] **Step 1: Run full check one more time**

```bash
bun run check
```

Expected: exit 0, all green.

- [ ] **Step 2: Push branch and open MR**

```bash
git push -u origin feat/push-library
```

Then open a GitLab MR from `feat/push-library` → `main` titled:

> feat: push copy template library admin page

MR description:
```
## Summary
- New `/push-library` page — authenticated users browse templates, admins (WorkOS `admin` role) can create/edit/delete
- `GET/POST /api/push-library` and `DELETE /api/push-library/[id]` with admin guards
- Edit uses existing `PATCH /api/variants/[id]` which syncs clones automatically
- Delete soft-archives (status → "archived"); clones keep working
- Sidebar nav item between Messages and Personas

## Test plan
- [ ] Run `bun run test tests/integration/push-library.test.ts` — all 8 pass
- [ ] Visit `/push-library` as a viewer — see templates, no edit/delete buttons
- [ ] Visit `/push-library` as dan.luk@youversion.com — see Edit/Delete/New Template
- [ ] Create a new template — appears in the list after save
- [ ] Edit a template — changes propagate, clones in agents update via cron
- [ ] Delete a template — archived, disappears from list
```

---

## Self-Review

### Spec coverage
- ✅ `/push-library` route with `BookOpen` nav item between Messages and Personas
- ✅ Header with template count + "New Template" button (admin only)
- ✅ Templates grouped by `category` + `subcategory`
- ✅ Each template shows `PushNotificationPreview`, name, subcategory badge, deeplink, Edit + Delete (admin only)
- ✅ Delete uses `AlertDialog` confirmation
- ✅ Create/Edit uses `Sheet` drawer
- ✅ Live preview in form
- ✅ `GET /api/push-library` returns grouped variants
- ✅ `POST /api/push-library` creates variant, admin only, 403 otherwise
- ✅ `PATCH /api/variants/[id]` used as-is for edits (existing route)
- ✅ `DELETE /api/push-library/[id]` soft-archives, admin only, 403 otherwise
- ✅ All tests in spec covered (GET grouped, POST admin, POST 403, DELETE admin, DELETE 403, archived excluded from GET)
- ✅ `getAuth()` helper added to `src/lib/auth.ts`
- ✅ `subcategory` hardcoded map in form matches spec exactly

### Placeholder scan
- No TBD/TODO items found.
- All code blocks are complete and self-contained.

### Type consistency
- `TemplateVariant` type defined in `page.tsx` and re-declared identically in `template-card.tsx` and `template-form-sheet.tsx` — consistent shape throughout.
- `getAuth()` returns `{ user, isAdmin: boolean }` — used consistently as `const { isAdmin } = await getAuth()` in both API routes and the page.
