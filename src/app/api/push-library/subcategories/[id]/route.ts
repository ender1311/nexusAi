import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { PUSH_TAXONOMY_TAG } from "@/lib/cache/push-taxonomy";

const DEEPLINK_BEHAVIORS = new Set(["none", "specific-verse"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const data: Prisma.PushSubcategoryUpdateInput = {};
  if (typeof body.label === "string") {
    if (!body.label.trim()) return fail("label cannot be empty", 400);
    data.label = body.label.trim();
  }
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.deeplinkBehavior === "string") {
    if (!DEEPLINK_BEHAVIORS.has(body.deeplinkBehavior)) return fail("Invalid deeplinkBehavior", 400);
    data.deeplinkBehavior = body.deeplinkBehavior;
  }
  if (typeof body.categoryId === "string") {
    const target = await prisma.pushCategory.findUnique({ where: { id: body.categoryId } });
    if (!target) return fail("categoryId does not exist", 400);
    data.category = { connect: { id: body.categoryId } };
  }
  if (Object.keys(data).length === 0) return fail("No valid fields to update", 400);

  try {
    const updated = await prisma.pushSubcategory.update({ where: { id }, data });
    revalidateTag(PUSH_TAXONOMY_TAG);
    return ok(updated);
  } catch (err) {
    return handleRouteError(`PATCH /api/push-library/subcategories/${id}`, err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;
  const { id } = await params;

  const sub = await prisma.pushSubcategory.findUnique({ where: { id } });
  if (!sub) return fail("Subcategory not found", 404);

  const inUse = await prisma.messageVariant.count({ where: { subcategory: sub.slug } });
  if (inUse > 0) {
    return fail(`Cannot delete — ${inUse} push(es) still use this subcategory. Recategorize them first`, 409);
  }
  try {
    await prisma.pushSubcategory.delete({ where: { id } });
    revalidateTag(PUSH_TAXONOMY_TAG);
    return ok({ id });
  } catch (err) {
    return handleRouteError(`DELETE /api/push-library/subcategories/${id}`, err);
  }
}
