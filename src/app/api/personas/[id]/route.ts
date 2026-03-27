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
    ...(traits.lifeContext !== undefined && { lifeContext: traits.lifeContext }),
    ...(traits.demographics !== undefined && { demographics: traits.demographics }),
    ...(traits.engagement !== undefined && { engagement: traits.engagement }),
    ...(traits.contentModes !== undefined && { contentModes: traits.contentModes }),
    ...(traits.features !== undefined && { features: traits.features }),
    ...(traits.channels !== undefined && { channels: traits.channels }),
    ...(traits.metrics !== undefined && { metrics: traits.metrics }),
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const persona = await prisma.persona.findUnique({
    where: { id },
    include: { _count: { select: { users: true } } },
  });
  if (!persona) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toApiPersona(persona));
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const { lifeContext, demographics, engagement, contentModes, features, channels, metrics, ...coreFields } = body;

  const existing = await prisma.persona.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existingTraits = JSON.parse(existing.traits || "{}");
  const updatedTraits = JSON.stringify({
    ...existingTraits,
    ...(lifeContext !== undefined && { lifeContext }),
    ...(demographics !== undefined && { demographics }),
    ...(engagement !== undefined && { engagement }),
    ...(contentModes !== undefined && { contentModes }),
    ...(features !== undefined && { features }),
    ...(channels !== undefined && { channels }),
    ...(metrics !== undefined && { metrics }),
  });

  const persona = await prisma.persona.update({
    where: { id },
    data: {
      ...(coreFields.name && { name: coreFields.name }),
      ...(coreFields.description !== undefined && { description: coreFields.description }),
      ...(coreFields.icon && { icon: coreFields.icon }),
      ...(coreFields.color && { color: coreFields.color }),
      ...(coreFields.label !== undefined && { label: coreFields.label }),
      ...(coreFields.tags && { tags: JSON.stringify(coreFields.tags) }),
      ...(coreFields.isActive !== undefined && { isActive: coreFields.isActive }),
      traits: updatedTraits,
    },
    include: { _count: { select: { users: true } } },
  });

  return NextResponse.json(toApiPersona(persona));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.persona.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
