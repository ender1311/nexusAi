import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("enrollmentMode default", () => {
  it("defaults to 'fixed' so existing agents are unaffected", async () => {
    const a = await createAgent({ name: "Legacy" });
    const row = await prisma.agent.findUnique({ where: { id: a.id } });
    expect(row?.enrollmentMode).toBe("fixed");
  });
});
