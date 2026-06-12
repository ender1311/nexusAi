import { Header } from "@/components/layout/header";
import { SegmentBuilder, type SegmentSummary } from "@/components/segments/segment-builder";
import { buildFacetMap } from "@/lib/segments/facet-types";
import {
  getCachedSegmentDefs,
  getCachedSegmentNames,
  getCachedSegmentFacets,
} from "@/lib/cache";
import { getCachedActivePersonas } from "@/lib/cache";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const [rows, personas, segmentNames, facetRows] = await Promise.all([
    getCachedSegmentDefs(),
    getCachedActivePersonas(),
    getCachedSegmentNames(),
    getCachedSegmentFacets(),
  ]);

  const segments: SegmentSummary[] = rows;
  const personaOptions = personas.map((p) => ({ value: p.id, label: p.name }));
  const segmentNameOptions = segmentNames.map((s) => s.segmentName);
  const facetMap = buildFacetMap(facetRows);

  return (
    <>
      <Header title="Segments" description="Build audience segments from your data fields and size them against the database." />
      <div className="flex-1 p-6">
        <SegmentBuilder segments={segments} personaOptions={personaOptions} segmentNameOptions={segmentNameOptions} facetMap={facetMap} />
      </div>
    </>
  );
}
