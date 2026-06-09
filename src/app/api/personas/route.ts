import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
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
    // Spread rich fields from traits JSON
    ...(traits.lifeContext !== undefined && { lifeContext: traits.lifeContext as string }),
    ...(traits.demographics !== undefined && { demographics: traits.demographics as Persona["demographics"] }),
    ...(traits.engagement !== undefined && { engagement: traits.engagement as Persona["engagement"] }),
    ...(traits.contentModes !== undefined && { contentModes: traits.contentModes as Persona["contentModes"] }),
    ...(traits.features !== undefined && { features: traits.features as string[] }),
    ...(traits.channels !== undefined && { channels: traits.channels as Persona["channels"] }),
    ...(traits.metrics !== undefined && { metrics: traits.metrics as Persona["metrics"] }),
    // Discovered persona traits
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

export async function GET() {
  try {
    const personas = await prisma.persona.findMany({
      where: { isActive: true },
      include: { _count: { select: { trackedUsers: true } } },
      orderBy: [{ source: "asc" }, { createdAt: "asc" }],
    });

    const res = NextResponse.json(personas.map(toApiPersona));
    res.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    return res;
  } catch (error) {
    console.error("GET /api/personas error:", error);
    return NextResponse.json({ error: "Failed to fetch personas" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (typeof body !== "object" || body === null || !body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Rich fields go into traits JSON
    const { lifeContext, demographics, engagement, contentModes, features, channels, metrics, ...coreFields } = body;
    const traits = { lifeContext, demographics, engagement, contentModes, features, channels, metrics };

    const persona = await prisma.persona.create({
      data: {
        name: coreFields.name,
        description: coreFields.description ?? null,
        icon: coreFields.icon ?? "Users2",
        color: coreFields.color ?? "blue",
        source: "manual",
        label: coreFields.label ?? null,
        tags: coreFields.tags ?? [],
        traits,
      },
      include: { _count: { select: { trackedUsers: true } } },
    });

    revalidateTag("personas", "max");

    return NextResponse.json(toApiPersona(persona), { status: 201 });
  } catch (error) {
    console.error("POST /api/personas error:", error);
    return NextResponse.json({ error: "Failed to create persona" }, { status: 500 });
  }
}
