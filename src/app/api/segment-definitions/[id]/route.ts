import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth";
import { parseSegmentRule } from "@/lib/segments/parse-rule";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const { id } = await params;
  try {
    const seg = await prisma.segment.findUnique({ where: { id } });
    if (!seg) return fail("Segment not found", 404);
    const rule = parseSegmentRule(seg.rule) ?? { kind: "group", join: "AND", children: [] };
    return ok({ ...seg, rule });
  } catch (err) {
    return handleRouteError("GET /api/segment-definitions/[id]", err);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const { id } = await params;
  try {
    const body = (await req.json()) as { name?: unknown; description?: unknown; rule?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail("Name is required", 400);

    const rule = parseSegmentRule(body.rule);
    if (rule === null) return fail("Invalid segment rule", 400);

    const existing = await prisma.segment.findUnique({ where: { id }, select: { rule: true } });
    if (!existing) return fail("Segment not found", 404);

    // Exclude this segment's own materialized rows from the clash check. Once the
    // materialize cron writes source='rule' rows under segmentName, an unfiltered
    // findFirst matches them and 409s every later edit — see the regression test.
    // Only a 'hightouch'-imported name is a genuine cross-system collision.
    const clash = await prisma.userSegment.findFirst({
      where: { segmentName: name, source: { not: "rule" } },
      select: { id: true },
    });
    if (clash) return fail("A segment with this name already exists", 409);

    // A changed rule invalidates the cached exact size (membership differs). Both
    // sides are normalized by parseSegmentRule, so the comparison is order-stable.
    const ruleChanged = JSON.stringify(parseSegmentRule(existing.rule)) !== JSON.stringify(rule);

    const updated = await prisma.segment.update({
      where: { id },
      data: {
        name,
        description: typeof body.description === "string" ? body.description : null,
        rule: rule as unknown as Prisma.InputJsonValue,
        ...(ruleChanged ? { sizeExact: null, sizeComputedAt: null } : {}),
      },
    });
    return ok(updated);
  } catch (err) {
    return handleRouteError("PUT /api/segment-definitions/[id]", err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const { id } = await params;
  try {
    await prisma.segment.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return handleRouteError("DELETE /api/segment-definitions/[id]", err);
  }
}
