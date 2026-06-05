import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {} }));

const { POST } = await import("@/app/api/push-library/reorder/route");

let ids: string[];
beforeEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  const agent = await createAgent({ name: "Push Copy Library" });
  const msg = await createMessage(agent.id, { channel: "push" });
  const a = await createVariant(msg.id, { name: "A", title: "A", body: "a", category: "giving", subcategory: "eoy" });
  const b = await createVariant(msg.id, { name: "B", title: "B", body: "b", category: "giving", subcategory: "eoy" });
  const c = await createVariant(msg.id, { name: "C", title: "C", body: "c", category: "giving", subcategory: "eoy" });
  ids = [a.id, b.id, c.id];
});
afterEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
});

describe("POST /api/push-library/reorder", () => {
  it("writes contiguous sortOrder in the given order", async () => {
    const reordered = [ids[2], ids[0], ids[1]];
    const res = await POST(new NextRequest("http://t", { method: "POST", body: JSON.stringify({ ids: reordered }) }));
    expect(res.status).toBe(200);
    const rows = await prisma.messageVariant.findMany({ where: { id: { in: ids } }, select: { id: true, sortOrder: true } });
    const order = new Map(rows.map((r) => [r.id, r.sortOrder]));
    expect(order.get(ids[2])).toBe(0);
    expect(order.get(ids[0])).toBe(1);
    expect(order.get(ids[1])).toBe(2);
  });

  it("rejects a non-array body with 400", async () => {
    const res = await POST(new NextRequest("http://t", { method: "POST", body: JSON.stringify({ ids: "nope" }) }));
    expect(res.status).toBe(400);
  });
});
