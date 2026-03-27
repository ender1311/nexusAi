import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Persona } from "@/types/persona";

function toApiPersona(p: {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  source: string;
  centroid: string | null;
  clusterSize: number;
  silhouetteScore: number | null;
  traits: string;
  label: string | null;
  tags: string;
  isActive: boolean;
  discoveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { users: number };
}): Persona {
  const traits = JSON.parse(p.traits || "{}");

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    icon: p.icon,
    color: p.color,
    source: p.source as "manual" | "discovered",
    isActive: p.isActive,
    tags: JSON.parse(p.tags || "[]"),
    clusterSize: p.clusterSize,
    silhouetteScore: p.silhouetteScore,
    discoveredAt: p.discoveredAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    label: p.label,
    _count: p._count,
    // Spread rich fields from traits JSON
    ...(traits.lifeContext !== undefined && { lifeContext: traits.lifeContext }),
    ...(traits.demographics !== undefined && { demographics: traits.demographics }),
    ...(traits.engagement !== undefined && { engagement: traits.engagement }),
    ...(traits.contentModes !== undefined && { contentModes: traits.contentModes }),
    ...(traits.features !== undefined && { features: traits.features }),
    ...(traits.channels !== undefined && { channels: traits.channels }),
    ...(traits.metrics !== undefined && { metrics: traits.metrics }),
    // Discovered persona traits
    ...(p.source === "discovered" && {
      discoveredTraits: {
        dominantChannel: traits.dominantChannel,
        peakHour: traits.peakHour,
        engagementLevel: traits.engagementLevel,
        conversionRate: traits.conversionRate,
      },
    }),
  };
}

export async function GET() {
  const personas = await prisma.persona.findMany({
    where: { isActive: true },
    include: { _count: { select: { users: true } } },
    orderBy: [{ source: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(personas.map(toApiPersona));
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Rich fields go into traits JSON
  const { lifeContext, demographics, engagement, contentModes, features, channels, metrics, ...coreFields } = body;
  const traits = JSON.stringify({ lifeContext, demographics, engagement, contentModes, features, channels, metrics });

  const persona = await prisma.persona.create({
    data: {
      name: coreFields.name,
      description: coreFields.description ?? null,
      icon: coreFields.icon ?? "Users2",
      color: coreFields.color ?? "blue",
      source: "manual",
      label: coreFields.label ?? null,
      tags: JSON.stringify(coreFields.tags ?? []),
      traits,
    },
    include: { _count: { select: { users: true } } },
  });

  return NextResponse.json(toApiPersona(persona), { status: 201 });
}
