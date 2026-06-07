import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth";
import { parseSegmentRule } from "@/lib/segments/parse-rule";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import { exactSegmentSize } from "@/lib/segments/sizing";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const { id } = await params;
  try {
    const seg = await prisma.segment.findUnique({ where: { id } });
    if (!seg) return fail("Segment not found", 404);

    const rule = parseSegmentRule(seg.rule);
    if (rule === null) return fail("Invalid segment rule", 400);

    const result = await exactSegmentSize(compileSegmentRule(rule));
    if (result.timedOut) {
      // Do NOT overwrite a prior good value with null on timeout.
      return ok({ count: null, computedAt: null, timedOut: true as const });
    }

    const computedAt = new Date();
    await prisma.segment.update({
      where: { id },
      data: { sizeExact: result.count, sizeComputedAt: computedAt },
    });
    return ok({ count: result.count, computedAt: computedAt.toISOString(), timedOut: false as const });
  } catch (err) {
    return handleRouteError("POST /api/segment-definitions/[id]/refresh-size", err);
  }
}
