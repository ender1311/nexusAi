import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { MODAL_IAM_CATEGORY_VALUES, MODAL_IAM_SUBCATEGORIES } from "@/lib/modal-iam-categories";

const FILTER_PARAMS = ["q", "category", "subcategory", "status", "sort", "dir", "limit", "cursor"];
const SORT_FIELDS = new Set(["createdAt", "name", "sortOrder"]);

const SELECT = {
  id: true, name: true, title: true, body: true, deeplink: true, iconImageUrl: true,
  status: true, category: true, subcategory: true, sortOrder: true,
} as const;

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const hasFilters = FILTER_PARAMS.some((p) => sp.has(p));

    const status = sp.get("status");
    const where: Prisma.MessageVariantWhereInput = {
      message: { agentId: null, channel: "modal-iam" },
      status: status ? status : { not: "archived" },
    };
    const category = sp.get("category");
    const subcategory = sp.get("subcategory");
    if (category) where.category = category;
    if (subcategory) where.subcategory = subcategory;
    const q = sp.get("q")?.trim();
    if (q) {
      where.OR = (["name", "title", "body", "deeplink"] as const).map((f) => ({
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
    return handleRouteError("GET /api/modal-iam-library", err);
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const { name, category, subcategory, title, body: msgBody, deeplink, imageUrl } = body as Record<string, unknown>;

  if (typeof name !== "string" || !name.trim()) return fail("name is required", 400);
  if (typeof category !== "string" || !MODAL_IAM_CATEGORY_VALUES.includes(category)) return fail("invalid category", 400);
  if (typeof title !== "string" || !title.trim()) return fail("title is required", 400);
  if (typeof msgBody !== "string" || !msgBody.trim()) return fail("body is required", 400);

  const subSlug = typeof subcategory === "string" && subcategory.trim() ? subcategory.trim() : null;
  if (subSlug && !MODAL_IAM_SUBCATEGORIES[category]?.includes(subSlug)) return fail("invalid subcategory", 400);

  try {
    let message = await prisma.message.findFirst({
      where: { agentId: null, channel: "modal-iam", variants: { some: { category } } },
    });
    if (!message) {
      message = await prisma.message.create({
        data: { agentId: null, name: `${category} Modal IAM Templates`, channel: "modal-iam" },
      });
    }

    const variant = await prisma.messageVariant.create({
      data: {
        messageId: message.id,
        name: name.trim(),
        title: (title as string).trim(),
        body: (msgBody as string).trim(),
        deeplink: typeof deeplink === "string" ? deeplink.trim() || null : null,
        iconImageUrl: typeof imageUrl === "string" ? imageUrl.trim() || null : null,
        category,
        subcategory: subSlug,
        status: "active",
      },
    });

    return ok(variant, 201);
  } catch (err) {
    return handleRouteError("POST /api/modal-iam-library", err);
  }
}
