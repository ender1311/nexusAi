// tests/regression/bandit-seeds-missing-arms.test.ts
//
// REGRESSION: /api/decide must seed PersonaArmStats at alpha=1,beta=1 for any
// variant with no prior record, not skip it or return an error.
// Without seeding, new variants would never be explored by Thompson Sampling.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createPersona, createMessage, createVariant, createUser, createSchedulingRule } from "../helpers/builders";
import { POST } from "@/app/api/decide/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("Bandit seeds missing arms (regression)", () => {
  it("seeds a brand new arm at alpha=1, beta=30 (pessimistic Beta(1,30) prior)", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ algorithm: "thompson" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_seed_reg", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    // No PersonaArmStats exist yet — decide must create them
    const before = await prisma.personaArmStats.count();
    expect(before).toBe(0);

    await POST(buildRequest("POST", { agentId: agent.id, externalUserId: "usr_seed_reg" }, AUTH) as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.alpha).toBe(1);
    expect(stats!.beta).toBe(30);
    expect(stats!.tries).toBe(0);
    expect(stats!.wins).toBe(0);
  });

  it("does not overwrite existing arm stats when seeding", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ algorithm: "thompson" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_seed_reg2", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    // Pre-seed with learned stats
    await prisma.personaArmStats.create({
      data: { personaId: persona.id, agentId: agent.id, variantId: variant.id, alpha: 10, beta: 2, tries: 12, wins: 10 },
    });

    await POST(buildRequest("POST", { agentId: agent.id, externalUserId: "usr_seed_reg2" }, AUTH) as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    // Must not reset learned values
    expect(stats!.alpha).toBe(10);
    expect(stats!.beta).toBe(2);
    expect(stats!.tries).toBe(12);
  });

  it("seeds multiple variants on first decision", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "A" });
    await createVariant(msg.id, { name: "B" });
    await createVariant(msg.id, { name: "C" });
    await createUser("usr_seed_multi", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", { agentId: agent.id, externalUserId: "usr_seed_multi" }, AUTH) as NextRequest);

    const count = await prisma.personaArmStats.count({
      where: { personaId: persona.id, agentId: agent.id },
    });
    expect(count).toBe(3); // one row per variant
  });
});
