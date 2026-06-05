import { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";

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
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) {
    return fail("ids must be an array of variant ids", 400);
  }
  if (ids.length === 0) return ok({ updated: 0 });

  try {
    await prisma.$transaction(
      (ids as string[]).map((id, i) =>
        prisma.messageVariant.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    revalidateTag("agents", "max");
    return ok({ updated: ids.length });
  } catch (err) {
    return handleRouteError("POST /api/push-library/reorder", err);
  }
}
