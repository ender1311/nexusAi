import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { PUSH_TAXONOMY_TAG } from "@/lib/cache/push-taxonomy";

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

  const data: Prisma.PushCategoryUpdateInput = {};
  if (typeof body.label === "string") {
    if (!body.label.trim()) return fail("label cannot be empty", 400);
    data.label = body.label.trim();
  }
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (Object.keys(data).length === 0) return fail("No valid fields to update", 400);

  try {
    const updated = await prisma.pushCategory.update({ where: { id }, data });
    revalidateTag(PUSH_TAXONOMY_TAG, "max");
    return ok(updated);
  } catch (err) {
    return handleRouteError(`PATCH /api/push-library/categories/${id}`, err); // P2025 → 404
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;
  const { id } = await params;

  const subCount = await prisma.pushSubcategory.count({ where: { categoryId: id } });
  if (subCount > 0) {
    return fail("Cannot delete a category that still has subcategories — move or delete them first", 409);
  }
  try {
    await prisma.pushCategory.delete({ where: { id } });
    revalidateTag(PUSH_TAXONOMY_TAG, "max");
    return ok({ id });
  } catch (err) {
    return handleRouteError(`DELETE /api/push-library/categories/${id}`, err); // P2025 → 404
  }
}
