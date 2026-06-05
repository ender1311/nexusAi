import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { getPushTaxonomy } from "@/lib/cache/push-taxonomy";
import { validateVariantTaxonomy } from "@/lib/push-taxonomy";

export async function POST(req: NextRequest) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const ids = body.ids;
  const op = body.op;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((x) => typeof x !== "string")) {
    return fail("ids must be a non-empty array of variant ids", 400);
  }
  const where = { id: { in: ids as string[] } };

  try {
    if (op === "recategorize") {
      const category = body.category;
      if (typeof category !== "string") return fail("category is required", 400);
      const subSlug = typeof body.subcategory === "string" && body.subcategory.trim() ? body.subcategory.trim() : null;
      const taxonomy = await getPushTaxonomy();
      const valid = validateVariantTaxonomy(taxonomy, category, subSlug);
      if (!valid.ok) return fail(valid.error ?? "invalid taxonomy", 400);
      const r = await prisma.messageVariant.updateMany({ where, data: { category, subcategory: subSlug } });
      revalidateTag("agents", "max");
      return ok({ updated: r.count });
    }
    if (op === "setStatus") {
      const status = body.status;
      if (typeof status !== "string" || !status.trim()) return fail("status is required", 400);
      const r = await prisma.messageVariant.updateMany({ where, data: { status } });
      revalidateTag("agents", "max");
      return ok({ updated: r.count });
    }
    if (op === "delete") {
      const r = await prisma.messageVariant.updateMany({ where, data: { status: "archived" } });
      revalidateTag("agents", "max");
      return ok({ updated: r.count });
    }
    return fail("Unknown op", 400);
  } catch (err) {
    return handleRouteError("POST /api/push-library/bulk", err);
  }
}
