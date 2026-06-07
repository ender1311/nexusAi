import { Header } from "@/components/layout/header";
import { prisma } from "@/lib/db";
import { SegmentBuilder, type SegmentSummary } from "@/components/segments/segment-builder";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const [rows, personas, segmentNames] = await Promise.all([
    prisma.segment.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, name: true, description: true, updatedAt: true } }),
    prisma.persona.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.userSegment.findMany({ distinct: ["segmentName"], select: { segmentName: true }, orderBy: { segmentName: "asc" } }),
  ]);

  const segments: SegmentSummary[] = rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  const personaOptions = personas.map((p) => ({ value: p.id, label: p.name }));
  const segmentNameOptions = segmentNames.map((s) => s.segmentName);

  return (
    <>
      <Header title="Segments" description="Build audience segments from your data fields and size them against the database." />
      <div className="flex-1 p-6">
        <SegmentBuilder segments={segments} personaOptions={personaOptions} segmentNameOptions={segmentNameOptions} />
      </div>
    </>
  );
}
