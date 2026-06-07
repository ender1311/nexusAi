import { Header } from "@/components/layout/header";
import { prisma } from "@/lib/db";
import { getCachedSegments } from "@/lib/cache/segments";
import { safeEstimateForRule, mergeSegmentSizeRows } from "@/lib/segments/size-rows";
import { SegmentSizesTable } from "@/components/segments/segment-sizes-table";

export const dynamic = "force-dynamic";

export default async function SizesPage() {
  const [ruleSegs, htSegs] = await Promise.all([
    prisma.segment.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, description: true, rule: true, sizeExact: true, sizeComputedAt: true, updatedAt: true },
    }),
    getCachedSegments(),
  ]);

  const estimates = await Promise.all(ruleSegs.map((s) => safeEstimateForRule(s.rule)));
  const ruleInputs = ruleSegs.map((s, i) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    estimate: estimates[i] ?? null,
    sizeExact: s.sizeExact,
    sizeComputedAt: s.sizeComputedAt,
    updatedAt: s.updatedAt,
  }));

  const rows = mergeSegmentSizeRows(ruleInputs, htSegs);

  return (
    <>
      <Header
        title="Sizes"
        description="Estimated and exact sizes for every audience you've built or imported from Hightouch."
      />
      <div className="flex-1 p-6">
        <SegmentSizesTable rows={rows} />
      </div>
    </>
  );
}
