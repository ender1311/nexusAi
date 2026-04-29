import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * POST /api/personas/migrate
 *
 * Safely handles persona list changes:
 * - Deactivate personas (soft-delete + cascade user reassignment + prune agent targets)
 * - Activate personas (re-enable + wire to active agents)
 *
 * This endpoint is the safe way to restructure your persona set.
 * It runs all mutations in a single transaction so the system is never
 * in a half-migrated state.
 *
 * Body:
 * {
 *   deactivateIds?: string[],   // persona IDs to deactivate
 *   activateIds?: string[],     // persona IDs to re-activate
 *   agentIds?: string[],        // agents to wire newly activated personas to
 *                               // defaults to all active agents
 *   reassignUsers?: boolean,    // null out personaId for affected users (default: true)
 * }
 *
 * Response:
 * {
 *   data: {
 *     deactivated: number,
 *     activated: number,
 *     usersReassigned: number,
 *     agentTargetsRemoved: number,
 *     agentTargetsAdded: number,
 *   }
 * }
 */

type MigrateBody = {
  deactivateIds?: string[];
  activateIds?: string[];
  agentIds?: string[];
  reassignUsers?: boolean;
};

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const {
    deactivateIds = [],
    activateIds = [],
    agentIds,
    reassignUsers = true,
  } = body as MigrateBody;

  if (!Array.isArray(deactivateIds) || !Array.isArray(activateIds)) {
    return NextResponse.json(
      { error: "deactivateIds and activateIds must be arrays" },
      { status: 400 }
    );
  }

  if (deactivateIds.length === 0 && activateIds.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one of deactivateIds or activateIds" },
      { status: 400 }
    );
  }

  // Overlap check — activating and deactivating the same persona is nonsensical
  const overlap = deactivateIds.filter((id) => activateIds.includes(id));
  if (overlap.length > 0) {
    return NextResponse.json(
      { error: "Persona IDs cannot appear in both deactivateIds and activateIds", overlap },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let usersReassigned = 0;
      let agentTargetsRemoved = 0;
      let agentTargetsAdded = 0;

      // ── Deactivations ──────────────────────────────────────────────────────
      if (deactivateIds.length > 0) {
        // Verify they exist
        const found = await tx.persona.findMany({
          where: { id: { in: deactivateIds } },
          select: { id: true },
        });
        if (found.length !== deactivateIds.length) {
          const foundIds = found.map((p) => p.id);
          const missing = deactivateIds.filter((id) => !foundIds.includes(id));
          throw new Error(`Personas not found: ${missing.join(", ")}`);
        }

        // Soft-deactivate
        await tx.persona.updateMany({
          where: { id: { in: deactivateIds } },
          data: { isActive: false },
        });

        // Null out personaId for users assigned to these personas so they get
        // re-assigned on next ingest cycle
        if (reassignUsers) {
          const updated = await tx.trackedUser.updateMany({
            where: { personaId: { in: deactivateIds } },
            data: { personaId: null, personaConfidence: null, personaAssignedAt: null },
          });
          usersReassigned = updated.count;
        }

        // Remove AgentPersonaTarget rows — these personas no longer serve traffic
        const removed = await tx.agentPersonaTarget.deleteMany({
          where: { personaId: { in: deactivateIds } },
        });
        agentTargetsRemoved = removed.count;

        // PersonaArmStats rows are kept intentionally — they provide historical
        // data and will be useful if the persona is re-activated later.
      }

      // ── Activations ────────────────────────────────────────────────────────
      if (activateIds.length > 0) {
        // Verify they exist
        const found = await tx.persona.findMany({
          where: { id: { in: activateIds } },
          select: { id: true },
        });
        if (found.length !== activateIds.length) {
          const foundIds = found.map((p) => p.id);
          const missing = activateIds.filter((id) => !foundIds.includes(id));
          throw new Error(`Personas not found: ${missing.join(", ")}`);
        }

        // Re-enable
        await tx.persona.updateMany({
          where: { id: { in: activateIds } },
          data: { isActive: true },
        });

        // Resolve target agents: caller can specify, otherwise wire to all active agents
        let targetAgentIds: string[];
        if (agentIds && agentIds.length > 0) {
          targetAgentIds = agentIds;
        } else {
          const activeAgents = await tx.agent.findMany({
            where: { status: "active" },
            select: { id: true },
          });
          targetAgentIds = activeAgents.map((a) => a.id);
        }

        // Create AgentPersonaTarget rows (skip already-existing pairs)
        for (const agentId of targetAgentIds) {
          for (const personaId of activateIds) {
            await tx.agentPersonaTarget.upsert({
              where: { agentId_personaId: { agentId, personaId } },
              update: {},
              create: { agentId, personaId },
            });
            agentTargetsAdded++;
          }
        }
      }

      return {
        deactivated: deactivateIds.length,
        activated: activateIds.length,
        usersReassigned,
        agentTargetsRemoved,
        agentTargetsAdded,
      };
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Migration failed";
    // Surface validation errors (persona not found) as 400; DB errors as 500
    const isValidation = message.startsWith("Personas not found");
    console.error("[personas/migrate] error:", err);
    return NextResponse.json({ error: message }, { status: isValidation ? 400 : 500 });
  }
}
