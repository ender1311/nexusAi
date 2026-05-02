import { prisma } from "@/lib/db";
import type { Persona } from "@/types/persona";
import { prismaPersonaToApi } from "./map-prisma-persona";

/**
 * Same listing as the Personas sidebar page: all personas, creation order.
 * Use this anywhere the UI should reflect what admins see under Personas.
 */
export async function listPersonasForPersonasPage(): Promise<Persona[]> {
  try {
    const rows = await prisma.persona.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { trackedUsers: true } } },
    });
    return rows.map(prismaPersonaToApi);
  } catch {
    return [];
  }
}

/** Active personas only — used by GET /api/personas for external/list consumers. */
export async function listActivePersonasOrdered(): Promise<Persona[]> {
  const rows = await prisma.persona.findMany({
    where: { isActive: true },
    include: { _count: { select: { trackedUsers: true } } },
    orderBy: [{ source: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(prismaPersonaToApi);
}
