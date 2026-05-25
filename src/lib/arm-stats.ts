import { prisma } from "@/lib/db";
import { randomUUID } from "crypto";
import { LinUCB } from "@/lib/engine/linucb";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Atomically apply temporal decay and a reward increment to a PersonaArmStats row.
 *
 * Uses PostgreSQL ON CONFLICT DO UPDATE so the entire read-modify-write is a
 * single atomic statement — concurrent calls for the same arm cannot interleave.
 *
 * Decay formula (industry standard, ~0.99/update):
 *   alpha_new = GREATEST(1, 1 + (alpha - 1) * 0.99 + deltaAlpha)
 *   beta_new  = GREATEST(1, 1 + (beta  - 1) * 0.99 + deltaBeta)
 *
 * GREATEST(1, ...) ensures alpha and beta never drop below their lower bound —
 * a defensive guard against any unexpected negative delta values.
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
  const initAlpha = Math.max(1, 1 + deltaAlpha);
  const initBeta  = Math.max(1, 30 + deltaBeta);
  const id = randomUUID();

  await prisma.$executeRaw`
    INSERT INTO "PersonaArmStats" (id, "personaId", "agentId", "variantId", alpha, beta, tries, wins)
    VALUES (${id}, ${personaId}, ${agentId}, ${variantId},
            ${initAlpha}::float8, ${initBeta}::float8, 1, ${deltaWins})
    ON CONFLICT ("personaId", "agentId", "variantId") DO UPDATE SET
      alpha = GREATEST(1.0, 1 + ("PersonaArmStats".alpha - 1) * 0.99 + ${deltaAlpha}::float8),
      beta  = GREATEST(1.0, 1 + ("PersonaArmStats".beta  - 1) * 0.99 + ${deltaBeta}::float8),
      tries = "PersonaArmStats".tries + 1,
      wins  = "PersonaArmStats".wins  + ${deltaWins}
  `;
}

/**
 * Atomically apply temporal decay and a reward increment to a UserArmStats row.
 * Mirrors upsertArmStats but operates on per-user arm statistics instead of per-persona.
 * Individual user data blends with the persona-level prior at decision time in the cron.
 */
export async function upsertUserArmStats(params: {
  userId: string;
  agentId: string;
  variantId: string;
  /** Reward increment added to alpha (0 for neutral/negative outcome) */
  deltaAlpha: number;
  /** Penalty increment added to beta (0 for positive outcome) */
  deltaBeta: number;
  /** 1 if this counts as a win, 0 otherwise */
  deltaWins: number;
}): Promise<void> {
  const { userId, agentId, variantId, deltaAlpha, deltaBeta, deltaWins } = params;
  const initAlpha = Math.max(1, 1 + deltaAlpha);
  const initBeta  = Math.max(1, 30 + deltaBeta);
  const id = randomUUID();

  await prisma.$executeRaw`
    INSERT INTO "UserArmStats" (id, "userId", "agentId", "variantId", alpha, beta, tries, wins)
    VALUES (${id}, ${userId}, ${agentId}, ${variantId},
            ${initAlpha}::float8, ${initBeta}::float8, 1, ${deltaWins})
    ON CONFLICT ("userId", "agentId", "variantId") DO UPDATE SET
      alpha = GREATEST(1.0, 1 + ("UserArmStats".alpha - 1) * 0.99 + ${deltaAlpha}::float8),
      beta  = GREATEST(1.0, 1 + ("UserArmStats".beta  - 1) * 0.99 + ${deltaBeta}::float8),
      tries = "UserArmStats".tries + 1,
      wins  = "UserArmStats".wins  + ${deltaWins}
  `;
}

/**
 * Batch version of upsertArmStats. All rows share the same delta values,
 * which is the common case in the analytics cron (one analytics result → N persona combos).
 * Runs all upserts in parallel to minimise wall-clock time vs. sequential iteration.
 */
export async function batchUpsertArmStats(
  rows: Array<{ personaId: string; agentId: string; variantId: string }>,
  delta: { deltaAlpha: number; deltaBeta: number; deltaWins: number },
): Promise<void> {
  if (rows.length === 0) return;
  await Promise.all(rows.map((r) => upsertArmStats({ ...r, ...delta })));
}

/**
 * Batch version of upsertUserArmStats. All rows share the same delta values.
 * Runs all upserts in parallel to minimise wall-clock time.
 */
export async function batchUpsertUserArmStats(
  rows: Array<{ userId: string; agentId: string; variantId: string }>,
  delta: { deltaAlpha: number; deltaBeta: number; deltaWins: number },
): Promise<void> {
  if (rows.length === 0) return;
  await Promise.all(rows.map((r) => upsertUserArmStats({ ...r, ...delta })));
}

/**
 * Apply a LinUCB Sherman-Morrison update to a LinUCBArm.
 * Loads the arm (creating with identity prior if missing), applies LinUCB.update(),
 * and persists the new aInv and b to the database.
 *
 * This closes the learning loop for the LinUCB algorithm:
 * without this call, theta = A^{-1}b = I*0 = 0 always.
 */
export async function updateLinUCBArm(params: {
  agentId: string;
  variantId: string;
  /** The feature context vector used at decision time (must be FEATURE_DIM length) */
  contextVec: number[];
  reward: number;
}): Promise<void> {
  const { agentId, variantId, contextVec, reward } = params;

  if (contextVec.length !== FEATURE_DIM) return;

  const linUCB = new LinUCB();

  let aInv: number[];
  let b: number[];

  const row = await prisma.linUCBArm.findUnique({
    where: { agentId_variantId: { agentId, variantId } },
  });

  if (!row || !Array.isArray(row.aInv) || (row.aInv as number[]).length !== FEATURE_DIM * FEATURE_DIM) {
    // No arm or stale dimension — initialize with identity prior and persist
    const initial = linUCB.initialArm(FEATURE_DIM);
    aInv = initial.aInv;
    b = initial.b;
    await prisma.linUCBArm.upsert({
      where: { agentId_variantId: { agentId, variantId } },
      create: {
        agentId,
        variantId,
        aInv: aInv as unknown as Prisma.InputJsonValue,
        b: b as unknown as Prisma.InputJsonValue,
        tries: 0,
      },
      update: {
        aInv: aInv as unknown as Prisma.InputJsonValue,
        b: b as unknown as Prisma.InputJsonValue,
        tries: 0,
      },
    });
  } else {
    aInv = row.aInv as number[];
    b = row.b as number[];
  }

  const { aInv: newAInv, b: newB } = linUCB.update(aInv, b, contextVec, reward);

  await prisma.linUCBArm.update({
    where: { agentId_variantId: { agentId, variantId } },
    data: {
      aInv: newAInv as unknown as Prisma.InputJsonValue,
      b: newB as unknown as Prisma.InputJsonValue,
      tries: { increment: 1 },
    },
  });
}
