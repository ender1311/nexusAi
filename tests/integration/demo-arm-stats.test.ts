import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createPersona } from "../helpers/builders";
import { GET } from "@/app/api/demo/arm-stats/route";

beforeEach(async () => {
  await truncateAll();
});
afterEach(async () => {
  await truncateAll();
});

describe("GET /api/demo/arm-stats", () => {
  it("returns 400 when agentId is missing", async () => {
    const req = new NextRequest("http://localhost/api/demo/arm-stats");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when agent does not exist", async () => {
    const req = new NextRequest("http://localhost/api/demo/arm-stats?agentId=nonexistent");
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("returns arm stats with persona and variant names", async () => {
    const agent = await createAgent();
    const persona = await createPersona({ name: "Morning Reader" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id, { name: "Variant A" });

    await prisma.personaArmStats.create({
      data: {
        agentId: agent.id,
        personaId: persona.id,
        variantId: variant.id,
        alpha: 10,
        beta: 5,
        tries: 15,
        wins: 8,
      },
    });

    const req = new NextRequest(`http://localhost/api/demo/arm-stats?agentId=${agent.id}`);
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.agentId).toBe(agent.id);
    expect(body.armStats).toHaveLength(1);

    const stat = body.armStats[0];
    expect(stat.alpha).toBe(10);
    expect(stat.beta).toBe(5);
    expect(stat.tries).toBe(15);
    expect(stat.wins).toBe(8);
    expect(stat.personaName).toBe("Morning Reader");
    expect(stat.personaColor).toBeDefined();
    expect(stat.variantName).toBe("Variant A");
    expect(stat.variantBody).toBeDefined();
  });

  it("returns empty armStats array when agent has no arm stats yet", async () => {
    const agent = await createAgent();
    const req = new NextRequest(`http://localhost/api/demo/arm-stats?agentId=${agent.id}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.armStats).toHaveLength(0);
  });
});
