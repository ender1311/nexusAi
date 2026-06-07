import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { requireAdmin, getAuth } from "@/lib/auth";
import { parseSegmentRule } from "@/lib/segments/parse-rule";
import type { Prisma } from "@/generated/prisma/client";

export async function GET() {
  try {
    const segments = await prisma.segment.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, description: true, updatedAt: true },
    });
    return ok(segments);
  } catch (err) {
    return handleRouteError("GET /api/segment-definitions", err);
  }
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const body = (await req.json()) as { name?: unknown; description?: unknown; rule?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail("Name is required", 400);

    const rule = parseSegmentRule(body.rule);
    if (rule === null) return fail("Invalid segment rule", 400);

    // Keep the rule-segment namespace coherent with imported Hightouch segment names.
    const clash = await prisma.userSegment.findFirst({ where: { segmentName: name }, select: { id: true } });
    if (clash) return fail("A segment with this name already exists", 409);

    const { user } = await getAuth();
    const created = await prisma.segment.create({
      data: {
        name,
        description: typeof body.description === "string" ? body.description : null,
        rule: rule as unknown as Prisma.InputJsonValue,
        createdBy: user?.email ?? null,
      },
    });
    return ok(created, 201);
  } catch (err) {
    return handleRouteError("POST /api/segment-definitions", err);
  }
}
