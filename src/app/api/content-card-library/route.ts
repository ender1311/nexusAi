import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { CONTENT_CARD_CATEGORY_VALUES, CONTENT_CARD_SUBCATEGORIES } from "@/lib/content-card-categories";
import { requireLibraryEditor } from "@/lib/auth";
import { archiveLibraryVariant } from "@/lib/api/archive-library-variant";

export async function DELETE(req: NextRequest) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;
  const id = new URL(req.url).searchParams.get("id");
  try {
    return await archiveLibraryVariant(id);
  } catch (err) {
    return handleRouteError("DELETE /api/content-card-library", err);
  }
}

const FILTER_PARAMS = ["q", "category", "subcategory", "status", "sort", "dir", "limit", "cursor"];
const SORT_FIELDS = new Set(["createdAt", "name", "sortOrder"]);

const SELECT = {
  id: true, name: true, title: true, body: true, cta: true, deeplink: true,
  status: true, category: true, subcategory: true, sortOrder: true,
} as const;

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const hasFilters = FILTER_PARAMS.some((p) => sp.has(p));

    const status = sp.get("status");
    const where: Prisma.MessageVariantWhereInput = {
      message: { agentId: null, channel: "content-card" },
      status: status ? status : { not: "archived" },
    };
    const category = sp.get("category");
    const subcategory = sp.get("subcategory");
    if (category) where.category = category;
    if (subcategory) where.subcategory = subcategory;
    const q = sp.get("q")?.trim();
    if (q) {
      where.OR = (["name", "title", "body", "cta", "deeplink"] as const).map((f) => ({
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
    return handleRouteError("GET /api/content-card-library", err);
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const { name, category, subcategory, title, body: msgBody, cta, deeplink } = body as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) return fail("name is required", 400);
  if (typeof category !== "string" || !CONTENT_CARD_CATEGORY_VALUES.includes(category)) return fail("invalid category", 400);
  if (typeof title !== "string" || !title.trim()) return fail("title is required", 400);
  if (typeof msgBody !== "string" || !msgBody.trim()) return fail("body is required", 400);

  const subSlug = typeof subcategory === "string" && subcategory.trim() ? subcategory.trim() : null;
  if (subSlug && !CONTENT_CARD_SUBCATEGORIES[category]?.includes(subSlug)) return fail("invalid subcategory", 400);

  try {
    let message = await prisma.message.findFirst({
      where: { agentId: null, channel: "content-card", variants: { some: { category } } },
    });
    if (!message) {
      message = await prisma.message.create({
        data: { agentId: null, name: `${category} Content Card Templates`, channel: "content-card" },
      });
    }

    const variant = await prisma.messageVariant.create({
      data: {
        messageId: message.id,
        name: name.trim(),
        title: title.trim(),
        body: msgBody.trim(),
        cta: typeof cta === "string" ? cta.trim() || null : null,
        deeplink: typeof deeplink === "string" ? deeplink.trim() || null : null,
        category,
        subcategory: subSlug,
        status: "active",
      },
    });

    return ok(variant, 201);
  } catch (err) {
    return handleRouteError("POST /api/content-card-library", err);
  }
}
