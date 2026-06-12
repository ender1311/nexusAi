import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { getCachedSegments, getCachedSegmentDefs } from "@/lib/cache/segments";
import { safeEstimateForRule, mergeSegmentSizeRows } from "@/lib/segments/size-rows";
import { SegmentSizesTable } from "@/components/segments/segment-sizes-table";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";

async function SizesContent() {
  const [ruleSegs, htSegs] = await Promise.all([
    getCachedSegmentDefs(),
    getCachedSegments(),
  ]);

  // Skip TABLESAMPLE estimate when sizeExact is already stored — avoids
  // expensive Neon cold-storage random-page reads for materialized segments.
  const estimates = await Promise.all(
    ruleSegs.map((s) => s.sizeExact !== null ? Promise.resolve(null) : safeEstimateForRule(s.rule))
  );

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
  return <SegmentSizesTable rows={rows} />;
}

function SizesSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

export default function SizesPage() {
  return (
    <>
      <Header
        title="Sizes"
        description="Estimated and exact sizes for every audience you've built or imported from Hightouch."
      />
      <div className="flex-1 p-6">
        <Suspense fallback={<SizesSkeleton />}>
          <SizesContent />
        </Suspense>
      </div>
    </>
  );
}
