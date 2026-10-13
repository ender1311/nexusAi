import { prisma } from "@/lib/db";
import { randomUUID } from "crypto";
import { LinUCB } from "@/lib/engine/linucb";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";
import { runChunked } from "@/lib/cron/chunk";
import type { Prisma } from "@/generated/prisma/client";

// Cap concurrent arm-stat upserts so a single analytics batch (up to ~500 rows)
// can't open ~500 Neon connections at once and exhaust the pool (a documented
// pool-exhaustion failure mode under concurrent cron + ingest load).
const ARM_STATS_WRITE_CONCURRENCY = 20;

// Bounded retries for the LinUCBArm compare-and-swap; contention beyond this
// is logged and the reward dropped rather than spinning a cron/ingest worker.
// Sized above ingest concurrency (INGEST_USER_CONCURRENCY = 10 chains can hit
// one arm): each round has at least one winner, so N writers land within N attempts.
export const LINUCB_MAX_CAS_ATTEMPTS = 25;

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
  await runChunked(rows, ARM_STATS_WRITE_CONCURRENCY, (r) => upsertArmStats({ ...r, ...delta }));
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
  await runChunked(rows, ARM_STATS_WRITE_CONCURRENCY, (r) => upsertUserArmStats({ ...r, ...delta }));
}

/**
 * Apply a LinUCB Sherman-Morrison update to a LinUCBArm.
 * Loads the arm (creating with identity prior if missing), applies LinUCB.update(),
 * and persists the new aInv and b with a compare-and-swap on `version`, retrying on contention.
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

  if (contextVec.length !== FEATURE_DIM) {
    console.warn(`[updateLinUCBArm] skipping — contextVec length ${contextVec.length} !== FEATURE_DIM ${FEATURE_DIM}`);
    return;
  }

  if (!contextVec.every(Number.isFinite)) {
    console.warn("[updateLinUCBArm] skipping — contextVec contains non-finite values");
    return;
  }

  const linUCB = new LinUCB();

  for (let attempt = 0; attempt < LINUCB_MAX_CAS_ATTEMPTS; attempt++) {
    const arm = await loadOrCreateLinUCBArm(agentId, variantId, linUCB);
    const { aInv: newAInv, b: newB } = linUCB.update(arm.aInv, arm.b, contextVec, reward);

    // Compare-and-swap on version: a concurrent writer bumps it first, this
    // write matches 0 rows, and we retry from a fresh read instead of
    // overwriting their update (A and b are sums, so retry order is irrelevant).
    const { count } = await prisma.linUCBArm.updateMany({
      where: { agentId, variantId, version: arm.version },
      data: {
        aInv: newAInv as unknown as Prisma.InputJsonValue,
        b: newB as unknown as Prisma.InputJsonValue,
        tries: arm.stale ? 1 : { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (count === 1) return;
    // Short random jitter so contending writers stop retrying in lockstep.
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5 * (attempt + 1)));
  }

  console.warn(
    `[updateLinUCBArm] dropped reward after ${LINUCB_MAX_CAS_ATTEMPTS} contended attempts agent=${agentId} variant=${variantId}`,
  );
}

/**
 * Read the arm, creating an identity-prior row if it does not exist. Never
 * overwrites an existing row: a concurrent creator's row (and any update
 * already applied to it) wins via skipDuplicates. A row with the wrong
 * dimension is returned as identity + stale=true; the caller's CAS write
 * replaces it wholesale.
 */
async function loadOrCreateLinUCBArm(
  agentId: string,
  variantId: string,
  linUCB: LinUCB,
): Promise<{ aInv: number[]; b: number[]; version: number; stale: boolean }> {
  const where = { agentId_variantId: { agentId, variantId } };
  const initial = linUCB.initialArm(FEATURE_DIM);

  let row = await prisma.linUCBArm.findUnique({ where });
  if (!row) {
    await prisma.linUCBArm.createMany({
      data: [{
        agentId,
        variantId,
        aInv: initial.aInv as unknown as Prisma.InputJsonValue,
        b: initial.b as unknown as Prisma.InputJsonValue,
        tries: 0,
      }],
      skipDuplicates: true,
    });
    row = await prisma.linUCBArm.findUniqueOrThrow({ where });
  }

  const hasValidShape =
    Array.isArray(row.aInv) && (row.aInv as number[]).length === FEATURE_DIM * FEATURE_DIM &&
    Array.isArray(row.b) && (row.b as number[]).length === FEATURE_DIM;
  if (!hasValidShape) {
    return { aInv: initial.aInv, b: initial.b, version: row.version, stale: true };
  }
  return { aInv: row.aInv as number[], b: row.b as number[], version: row.version, stale: false };
}
