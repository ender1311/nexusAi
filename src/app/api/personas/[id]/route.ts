import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Persona } from "@/types/persona";
import { requireAdmin } from "@/lib/auth";

function toApiPersona(p: {
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
}): Persona {
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const persona = await prisma.persona.findUnique({
      where: { id },
      include: { _count: { select: { trackedUsers: true } } },
    });
    if (!persona) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(toApiPersona(persona));
  } catch (error) {
    console.error("GET /api/personas/[id] error:", error);
    return NextResponse.json({ error: "Failed to fetch persona" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const { id } = await params;
    const body = await req.json();

    const { lifeContext, demographics, engagement, contentModes, features, channels, metrics, ...coreFields } = body;

    const existing = await prisma.persona.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const existingTraits = (existing.traits as unknown as Record<string, unknown>) ?? {};
    const updatedTraits = {
      ...existingTraits,
      ...(lifeContext !== undefined && { lifeContext }),
      ...(demographics !== undefined && { demographics }),
      ...(engagement !== undefined && { engagement }),
      ...(contentModes !== undefined && { contentModes }),
      ...(features !== undefined && { features }),
      ...(channels !== undefined && { channels }),
      ...(metrics !== undefined && { metrics }),
    };

    const persona = await prisma.persona.update({
      where: { id },
      data: {
        ...(coreFields.name && { name: coreFields.name }),
        ...(coreFields.description !== undefined && { description: coreFields.description }),
        ...(coreFields.icon && { icon: coreFields.icon }),
        ...(coreFields.color && { color: coreFields.color }),
        ...(coreFields.label !== undefined && { label: coreFields.label }),
        ...(coreFields.tags && { tags: coreFields.tags }),
        ...(coreFields.isActive !== undefined && { isActive: coreFields.isActive }),
        traits: updatedTraits,
      },
      include: { _count: { select: { trackedUsers: true } } },
    });

    return NextResponse.json(toApiPersona(persona));
  } catch (error) {
    console.error("PUT /api/personas/[id] error:", error);
    return NextResponse.json({ error: "Failed to update persona" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const { id } = await params;
    await prisma.persona.update({ where: { id }, data: { isActive: false } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/personas/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete persona" }, { status: 500 });
  }
}
