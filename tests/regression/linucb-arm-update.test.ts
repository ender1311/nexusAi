// tests/regression/linucb-arm-update.test.ts
//
// REGRESSION: LinUCB.update() (Sherman-Morrison rank-1 matrix update) was never called
// when rewards arrived — arms never learned. theta = A^{-1}b = I*0 = 0 always.
// Fixed by adding updateLinUCBArm() in src/lib/arm-stats.ts.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { updateLinUCBArm } from "@/lib/arm-stats";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";
import type { Prisma } from "@/generated/prisma/client";

beforeEach(async () => {
  await truncateAll();
});
afterEach(async () => {
  await truncateAll();
});

describe("updateLinUCBArm (regression — LinUCB arms must learn from rewards)", () => {
  it("accumulates reward into b vector and increments tries", async () => {
    const agent = await createAgent({ algorithm: "linucb" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);

    // Pre-create arm with identity matrix
    const { LinUCB } = await import("@/lib/engine/linucb");
    const initial = new LinUCB().initialArm(FEATURE_DIM);
    await prisma.linUCBArm.create({
      data: {
        agentId:  agent.id,
        variantId: variant.id,
        aInv:     initial.aInv as unknown as Prisma.InputJsonValue,
        b:        initial.b as unknown as Prisma.InputJsonValue,
        tries:    0,
      },
    });

    // Context vector with a positive signal in the first dimension
    const contextVec = new Array<number>(FEATURE_DIM).fill(0);
    contextVec[0] = 1;

    await updateLinUCBArm({
      agentId:    agent.id,
      variantId:  variant.id,
      contextVec,
      reward:     1.0,
    });

    const arm = await prisma.linUCBArm.findUniqueOrThrow({
      where: { agentId_variantId: { agentId: agent.id, variantId: variant.id } },
    });

    // b[0] should be reward * contextVec[0] = 1.0 * 1 = 1.0 (> 0)
    const b = arm.b as number[];
    expect(b[0]).toBeGreaterThan(0);

    // tries should be incremented to 1
    expect(arm.tries).toBe(1);
  });

  it("creates a fresh arm with identity prior when no arm exists yet", async () => {
    const agent = await createAgent({ algorithm: "linucb" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);

    const contextVec = new Array<number>(FEATURE_DIM).fill(0);
    contextVec[0] = 1;

    // No arm pre-created — updateLinUCBArm should upsert and still apply the update
    await updateLinUCBArm({
      agentId:    agent.id,
      variantId:  variant.id,
      contextVec,
      reward:     1.0,
    });

    const arm = await prisma.linUCBArm.findUniqueOrThrow({
      where: { agentId_variantId: { agentId: agent.id, variantId: variant.id } },
    });

    const b = arm.b as number[];
    expect(b[0]).toBeGreaterThan(0);
    expect(arm.tries).toBe(1);
  });

  it("silently skips when contextVec has wrong dimension", async () => {
    const agent = await createAgent({ algorithm: "linucb" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);

    const { LinUCB } = await import("@/lib/engine/linucb");
    const initial = new LinUCB().initialArm(FEATURE_DIM);
    await prisma.linUCBArm.create({
      data: {
        agentId:  agent.id,
        variantId: variant.id,
        aInv:     initial.aInv as unknown as Prisma.InputJsonValue,
        b:        initial.b as unknown as Prisma.InputJsonValue,
        tries:    0,
      },
    });

    // Wrong dimension — should be a no-op
    await updateLinUCBArm({
      agentId:    agent.id,
      variantId:  variant.id,
      contextVec: [1, 0, 0],  // wrong length
      reward:     1.0,
    });

    const arm = await prisma.linUCBArm.findUniqueOrThrow({
      where: { agentId_variantId: { agentId: agent.id, variantId: variant.id } },
    });

    // b should remain all zeros, tries unchanged
    const b = arm.b as number[];
    expect(b.every((v) => v === 0)).toBe(true);
    expect(arm.tries).toBe(0);
  });
});
