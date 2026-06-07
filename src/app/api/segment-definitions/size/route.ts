import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { parseSegmentRule } from "@/lib/segments/parse-rule";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import { estimateSegmentSize, exactSegmentSize } from "@/lib/segments/sizing";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { mode?: unknown; rule?: unknown };
    if (body.mode !== "estimate" && body.mode !== "exact") {
      return fail("mode must be 'estimate' or 'exact'", 400);
    }
    const rule = parseSegmentRule(body.rule);
    if (rule === null) return fail("Invalid segment rule", 400);

    const where = compileSegmentRule(rule);
    if (body.mode === "estimate") {
      const count = await estimateSegmentSize(where);
      return ok({ count, mode: "estimate" as const });
    }
    const result = await exactSegmentSize(where);
    return ok({ count: result.count, mode: "exact" as const, timedOut: result.timedOut });
  } catch (err) {
    return handleRouteError("POST /api/segment-definitions/size", err);
  }
}
