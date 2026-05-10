/**
 * Regression test: concurrent TrackedUser creation must not race.
 *
 * Bug: the cron path of decideForUser used findUnique() ?? create() to
 * fetch-or-create a TrackedUser. Two concurrent callers for the same new
 * externalUserId could both receive null from findUnique (user not yet
 * created), then both attempt create(), triggering a unique constraint
 * violation (P2002) on TrackedUser.externalId.
 *
 * Fix: the findUnique/create pair was replaced with upsert() + a P2002
 * catch-and-read fallback. The Neon driver adapter implements upsert as
 * SELECT + INSERT rather than native ON CONFLICT, so a P2002 can still
 * surface under true concurrency. The catch reads the row created by the
 * winning caller, so both callers complete successfully.
 *
 * These tests exercise the exact code pattern used in decide.ts step 2:
 *   upsert().catch(P2002 → findUniqueOrThrow)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

/** The fixed upsert pattern — mirrors what decide.ts does in step 2. */
async function safeUpsertUser(externalId: string) {
  return prisma.trackedUser
    .upsert({
      where: { externalId },
      create: { externalId },
      update: {},
    })
    .catch(async (err: { code?: string }) => {
      if (err?.code === "P2002") {
        return prisma.trackedUser.findUniqueOrThrow({ where: { externalId } });
      }
      throw err;
    });
}

describe("TrackedUser upsert: concurrent creation race", () => {
  it("two concurrent upserts for the same new externalId both succeed", async () => {
    const externalId = "usr-race-concurrent";

    // Before the fix: one of these would throw P2002 (unique constraint on externalId).
    // After the fix: the losing caller catches P2002 and reads the row created by the winner.
    const [u1, u2] = await Promise.all([
      safeUpsertUser(externalId),
      safeUpsertUser(externalId),
    ]);

    expect(u1.externalId).toBe(externalId);
    expect(u2.externalId).toBe(externalId);

    // The row must have been created exactly once
    const count = await prisma.trackedUser.count({ where: { externalId } });
    expect(count).toBe(1);
  });

  it("multiple concurrent upserts for the same new externalId all succeed", async () => {
    const externalId = "usr-race-5way";

    const results = await Promise.all(
      Array.from({ length: 5 }, () => safeUpsertUser(externalId))
    );

    for (const u of results) {
      expect(u.externalId).toBe(externalId);
    }
    const count = await prisma.trackedUser.count({ where: { externalId } });
    expect(count).toBe(1);
  });

  it("upsert for an already-existing user returns the existing row without error", async () => {
    const externalId = "usr-exists-before";

    // Pre-create the user
    await prisma.trackedUser.create({ data: { externalId } });

    // Upsert should idempotently return the existing row
    const u = await safeUpsertUser(externalId);
    expect(u.externalId).toBe(externalId);

    const count = await prisma.trackedUser.count({ where: { externalId } });
    expect(count).toBe(1);
  });

  it("sequential calls produce exactly one TrackedUser row", async () => {
    const externalId = "usr-sequential-upsert";

    const u1 = await safeUpsertUser(externalId);
    const u2 = await safeUpsertUser(externalId);

    expect(u1.externalId).toBe(externalId);
    expect(u2.externalId).toBe(externalId);
    expect(u1.id).toBe(u2.id); // same row returned both times

    const count = await prisma.trackedUser.count({ where: { externalId } });
    expect(count).toBe(1);
  });
});
