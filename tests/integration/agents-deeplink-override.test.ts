import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "@/lib/db";
import { createAgent } from "../helpers/builders";
import { PATCH } from "@/app/api/agents/[id]/route";

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://test/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id }) },
  );
}

describe("PATCH /api/agents/[id] deeplinkOverride", () => {
  it("persists a non-empty override string", async () => {
    const agent = await createAgent({ name: `dl-${Date.now()}` });
    const res = await patch(agent.id, { deeplinkOverride: "https://www.bible.com/verse-of-the-day" });
    expect(res.status).toBe(200);
    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh?.deeplinkOverride).toBe("https://www.bible.com/verse-of-the-day");
  });

  it("clears the override when null", async () => {
    const agent = await createAgent({ name: `dl-${Date.now()}-2` });
    await patch(agent.id, { deeplinkOverride: "https://x.example" });
    const res = await patch(agent.id, { deeplinkOverride: null });
    expect(res.status).toBe(200);
    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh?.deeplinkOverride).toBeNull();
  });

  it("rejects an empty string with 400", async () => {
    const agent = await createAgent({ name: `dl-${Date.now()}-3` });
    const res = await patch(agent.id, { deeplinkOverride: "   " });
    expect(res.status).toBe(400);
  });
});

afterAll(async () => {
  await prisma.agent.deleteMany({ where: { name: { startsWith: "dl-" } } });
});
