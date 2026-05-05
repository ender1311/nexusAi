import { prisma } from "@/lib/db";
import { randomUUID } from "crypto";

/**
 * Atomically apply temporal decay and a reward increment to a PersonaArmStats row.
 *
 * Uses PostgreSQL ON CONFLICT DO UPDATE so the entire read-modify-write is a
 * single atomic statement — concurrent calls for the same arm cannot interleave.
 *
 * Decay formula (industry standard, ~0.99/update):
 *   alpha_new = 1 + (alpha - 1) * 0.99 + deltaAlpha
 *   beta_new  = 1 + (beta  - 1) * 0.99 + deltaBeta
 *
 * Initial row (pessimistic prior): alpha = 1 + deltaAlpha, beta = 30 + deltaBeta
 */
export async function upsertArmStats(params: {
  personaId: string;
  agentId: string;
  variantId: string;
  /** Reward increment added to alpha (0 for neutral/negative outcome) */
  deltaAlpha: number;
  /** Penalty increment added to beta (0 for positive outcome) */
  deltaBeta: number;
  /** 1 if this counts as a win, 0 otherwise */
  deltaWins: number;
}): Promise<void> {
  const { personaId, agentId, variantId, deltaAlpha, deltaBeta, deltaWins } = params;
  const initAlpha = 1 + deltaAlpha;
  const initBeta = 30 + deltaBeta;
  const id = randomUUID();

  await prisma.$executeRaw`
    INSERT INTO "PersonaArmStats" (id, "personaId", "agentId", "variantId", alpha, beta, tries, wins)
    VALUES (${id}, ${personaId}, ${agentId}, ${variantId},
            ${initAlpha}::float8, ${initBeta}::float8, 1, ${deltaWins})
    ON CONFLICT ("personaId", "agentId", "variantId") DO UPDATE SET
      alpha = 1 + ("PersonaArmStats".alpha - 1) * 0.99 + ${deltaAlpha}::float8,
      beta  = 1 + ("PersonaArmStats".beta  - 1) * 0.99 + ${deltaBeta}::float8,
      tries = "PersonaArmStats".tries + 1,
      wins  = "PersonaArmStats".wins  + ${deltaWins}
  `;
}
