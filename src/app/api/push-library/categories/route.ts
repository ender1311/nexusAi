import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { slugify } from "@/lib/push-taxonomy";
import { PUSH_TAXONOMY_TAG } from "@/lib/cache/push-taxonomy";

export async function GET() {
  try {
    const categories = await prisma.pushCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: { subcategories: { orderBy: { sortOrder: "asc" } } },
    });
    return ok(categories);
  } catch (err) {
    return handleRouteError("GET /api/push-library/categories", err);
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

  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return fail("label is required", 400);
  const slug = typeof body.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(label);
  if (!slug) return fail("label must contain alphanumeric characters", 400);

  try {
    const max = await prisma.pushCategory.aggregate({ _max: { sortOrder: true } });
    const created = await prisma.pushCategory.create({
      data: { slug, label, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    revalidateTag(PUSH_TAXONOMY_TAG, "max");
    return ok(created, 201);
  } catch (err) {
    return handleRouteError("POST /api/push-library/categories", err); // P2002 → 409
  }
}
