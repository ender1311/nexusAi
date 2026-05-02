import type { Persona } from "@/types/persona";

/** Prisma row + optional `_count` from include — shared by API routes and server pages. */
export type PrismaPersonaRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  source: string;
  centroid: unknown;
  clusterSize: number;
  silhouetteScore: number | null;
  traits: unknown;
  label: string | null;
  tags: unknown;
  isActive: boolean;
  discoveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { trackedUsers: number };
};

export function prismaPersonaToApi(p: PrismaPersonaRow): Persona {
  const traits = (p.traits as Record<string, unknown>) ?? {};

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    icon: p.icon,
    color: p.color,
    source: p.source as "manual" | "discovered",
    isActive: p.isActive,
    tags: (p.tags as string[]) ?? [],
    clusterSize: p.clusterSize,
    silhouetteScore: p.silhouetteScore,
    discoveredAt: p.discoveredAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    label: p.label,
    _count: p._count,
    ...(traits.lifeContext !== undefined && { lifeContext: traits.lifeContext as string }),
    ...(traits.demographics !== undefined && { demographics: traits.demographics as Persona["demographics"] }),
    ...(traits.engagement !== undefined && { engagement: traits.engagement as Persona["engagement"] }),
    ...(traits.contentModes !== undefined && { contentModes: traits.contentModes as Persona["contentModes"] }),
    ...(traits.features !== undefined && { features: traits.features as string[] }),
    ...(traits.channels !== undefined && { channels: traits.channels as Persona["channels"] }),
    ...(traits.metrics !== undefined && { metrics: traits.metrics as Persona["metrics"] }),
    ...(p.source === "discovered" && {
      discoveredTraits: {
        dominantChannel: traits.dominantChannel as string | undefined,
        peakHour: traits.peakHour as number | undefined,
        engagementLevel: traits.engagementLevel as string | undefined,
        conversionRate: traits.conversionRate as number | undefined,
      },
    }),
  };
}
