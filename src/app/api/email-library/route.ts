import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { EMAIL_CATEGORY_VALUES, EMAIL_SUBCATEGORIES } from "@/lib/email-categories";
import { requireLibraryEditor } from "@/lib/auth";
import { archiveLibraryVariant } from "@/lib/api/archive-library-variant";

export async function DELETE(req: NextRequest) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;
  const id = new URL(req.url).searchParams.get("id");
  try {
    return await archiveLibraryVariant(id);
  } catch (err) {
    return handleRouteError("DELETE /api/email-library", err);
  }
}

const FILTER_PARAMS = ["q", "category", "subcategory", "status", "sort", "dir", "limit", "cursor"];
const SORT_FIELDS = new Set(["createdAt", "name", "sortOrder"]);

const SELECT = {
  id: true, name: true, subject: true, body: true, deeplink: true,
  cta: true, status: true, category: true, subcategory: true, sortOrder: true,
  // htmlBody intentionally excluded from list view — too large
  translations: {
    select: { language: true, subject: true, status: true },
    where: { status: "active" },
  },
} as const;

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const hasFilters = FILTER_PARAMS.some((p) => sp.has(p));

    const status = sp.get("status");
    const where: Prisma.MessageVariantWhereInput = {
      message: { agentId: null, channel: "email" },
      status: status ? status : { not: "archived" },
    };
    const category = sp.get("category");
    const subcategory = sp.get("subcategory");
    if (category) where.category = category;
    if (subcategory) where.subcategory = subcategory;
    const q = sp.get("q")?.trim();
    if (q) {
      where.OR = (["name", "subject", "body", "cta", "deeplink"] as const).map((f) => ({
        [f]: { contains: q, mode: "insensitive" },
      }));
    }

    if (!hasFilters) {
      const variants = await prisma.messageVariant.findMany({
        where, select: SELECT,
        orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      });
      const grouped = new Map<string, Map<string | null, typeof variants>>();
      for (const v of variants) {
        const cat = v.category ?? "uncategorized";
        if (!grouped.has(cat)) grouped.set(cat, new Map());
        const subMap = grouped.get(cat)!;
        const sub = v.subcategory ?? null;
        if (!subMap.has(sub)) subMap.set(sub, []);
        subMap.get(sub)!.push(v);
      }
      const data = Array.from(grouped.entries()).flatMap(([c, subMap]) =>
        Array.from(subMap.entries()).map(([s, vs]) => ({ category: c, subcategory: s, variants: vs })),
      );
      const res = NextResponse.json({ data });
      res.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
      return res;
    }

    const sortField = SORT_FIELDS.has(sp.get("sort") ?? "") ? sp.get("sort")! : "createdAt";
    const dir = sp.get("dir") === "desc" ? "desc" : "asc";
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 100, 1), 200);
    const cursor = sp.get("cursor");

    const [total, items] = await Promise.all([
      prisma.messageVariant.count({ where }),
      prisma.messageVariant.findMany({
        where, select: SELECT,
        orderBy: [{ [sortField]: dir }, { id: "asc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
    ]);
    const nextCursor = items.length > limit ? items[limit - 1].id : null;
    return ok({ items: items.slice(0, limit), total, nextCursor });
  } catch (err) {
    return handleRouteError("GET /api/email-library", err);
  }
}

// PATCH /api/email-library?id=<variantId> — returns full htmlBody for a single variant
export async function PATCH(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const id = sp.get("id");
  if (!id) return fail("id is required", 400);

  try {
    const variant = await prisma.messageVariant.findUnique({
      where: { id },
      select: { htmlBody: true, translations: { select: { language: true, htmlBody: true } } },
    });
    if (!variant) return fail("not found", 404);
    return ok(variant);
  } catch (err) {
    return handleRouteError("PATCH /api/email-library", err);
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const { name, category, subcategory, subject, htmlBody, cta, deeplink } = body as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) return fail("name is required", 400);
  if (typeof category !== "string" || !EMAIL_CATEGORY_VALUES.includes(category)) return fail("invalid category", 400);
  if (typeof subject !== "string" || !subject.trim()) return fail("subject is required for email", 400);
  if (typeof htmlBody !== "string" || !htmlBody.trim()) return fail("htmlBody is required for email", 400);

  const subSlug = typeof subcategory === "string" && subcategory.trim() ? subcategory.trim() : null;
  if (subSlug && !EMAIL_SUBCATEGORIES[category]?.includes(subSlug)) return fail("invalid subcategory", 400);

  try {
    let message = await prisma.message.findFirst({
      where: { agentId: null, channel: "email", variants: { some: { category } } },
    });
    if (!message) {
      message = await prisma.message.create({
        data: { agentId: null, name: `${category} Email Templates`, channel: "email" },
      });
    }

    const variant = await prisma.messageVariant.create({
      data: {
        messageId: message.id,
        name: name.trim(),
        subject: subject.trim(),
        htmlBody: htmlBody.trim(),
        body: subject.trim(),
        deeplink: typeof deeplink === "string" ? deeplink.trim() || null : null,
        cta: typeof cta === "string" ? cta.trim() || null : null,
        category,
        subcategory: subSlug,
        status: "active",
      },
    });

    revalidateTag("agents", "max"); // bust the cached email-library list
    return ok(variant, 201);
  } catch (err) {
    return handleRouteError("POST /api/email-library", err);
  }
}
