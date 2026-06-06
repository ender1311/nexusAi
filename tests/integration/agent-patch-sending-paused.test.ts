import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";
import { PATCH as patchAgent } from "@/app/api/agents/[id]/route";
import { NextRequest } from "next/server";
import { buildRequest } from "../helpers/request";

const PREFIX = "pauseint-";

function patch(id: string, body: unknown) {
  const req = buildRequest("PATCH", body);
  return patchAgent(req as NextRequest, { params: Promise.resolve({ id }) });
}

describe("PATCH sendingPaused (integration)", () => {
  it("round-trips true then false", async () => {
    const agent = await createAgent({ name: `${PREFIX}${Date.now()}`, status: "active" });
    expect((await patch(agent.id, { sendingPaused: true })).status).toBe(200);
    expect((await prisma.agent.findUnique({ where: { id: agent.id } }))!.sendingPaused).toBe(true);
    expect((await patch(agent.id, { sendingPaused: false })).status).toBe(200);
    expect((await prisma.agent.findUnique({ where: { id: agent.id } }))!.sendingPaused).toBe(false);
  });

  it("rejects non-boolean with 400", async () => {
    const agent = await createAgent({ name: `${PREFIX}b-${Date.now()}`, status: "active" });
    expect((await patch(agent.id, { sendingPaused: "yes" })).status).toBe(400);
  });
});

afterAll(async () => {
  await prisma.agent.deleteMany({ where: { name: { startsWith: PREFIX } } });
});
