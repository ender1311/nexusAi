import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { slugify } from "@/lib/push-taxonomy";
import { PUSH_TAXONOMY_TAG } from "@/lib/cache/push-taxonomy";

const DEEPLINK_BEHAVIORS = new Set(["none", "specific-verse"]);

export async function POST(req: NextRequest) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const categoryId = typeof body.categoryId === "string" ? body.categoryId : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!categoryId) return fail("categoryId is required", 400);
  if (!label) return fail("label is required", 400);
  const slug = typeof body.slug === "string" && body.slug.trim() ? slugify(body.slug) : slugify(label);
  if (!slug) return fail("label must contain alphanumeric characters", 400);
  const deeplinkBehavior = typeof body.deeplinkBehavior === "string" ? body.deeplinkBehavior : "none";
  if (!DEEPLINK_BEHAVIORS.has(deeplinkBehavior)) return fail("Invalid deeplinkBehavior", 400);

  const category = await prisma.pushCategory.findUnique({ where: { id: categoryId } });
  if (!category) return fail("categoryId does not exist", 400);

  try {
    const max = await prisma.pushSubcategory.aggregate({ where: { categoryId }, _max: { sortOrder: true } });
    const created = await prisma.pushSubcategory.create({
      data: { categoryId, slug, label, deeplinkBehavior, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    revalidateTag(PUSH_TAXONOMY_TAG, "max");
    return ok(created, 201);
  } catch (err) {
    return handleRouteError("POST /api/push-library/subcategories", err); // P2002 → 409
  }
}
