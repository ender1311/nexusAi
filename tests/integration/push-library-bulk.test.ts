import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { POST } = await import("@/app/api/push-library/bulk/route");

let ids: string[];
beforeEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
  const giving = await prisma.pushCategory.create({ data: { slug: "giving", label: "Giving" } });
  await prisma.pushSubcategory.create({ data: { categoryId: giving.id, slug: "eoy", label: "EOY" } });
  const agent = await createAgent({ name: "Push Copy Library" });
  const msg = await createMessage(agent.id, { channel: "push" });
  const a = await createVariant(msg.id, { name: "A", title: "A", body: "a", category: "reader", subcategory: "open-bible" });
  const b = await createVariant(msg.id, { name: "B", title: "B", body: "b", category: "reader", subcategory: "open-bible" });
  ids = [a.id, b.id];
});
afterEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

function post(body: unknown) {
  return POST(new NextRequest("http://t", { method: "POST", body: JSON.stringify(body) }));
}

describe("POST /api/push-library/bulk", () => {
  it("bulk recategorizes after validating the target pair", async () => {
    const res = await post({ ids, op: "recategorize", category: "giving", subcategory: "eoy" });
    expect(res.status).toBe(200);
    const rows = await prisma.messageVariant.findMany({ where: { id: { in: ids } }, select: { category: true, subcategory: true } });
    expect(rows.every((r) => r.category === "giving" && r.subcategory === "eoy")).toBe(true);
  });

  it("rejects bulk recategorize to an invalid pair with 400", async () => {
    const res = await post({ ids, op: "recategorize", category: "giving", subcategory: "open-bible" });
    expect(res.status).toBe(400);
  });

  it("bulk sets status", async () => {
    const res = await post({ ids, op: "setStatus", status: "paused" });
    expect(res.status).toBe(200);
    const rows = await prisma.messageVariant.findMany({ where: { id: { in: ids } }, select: { status: true } });
    expect(rows.every((r) => r.status === "paused")).toBe(true);
  });

  it("bulk delete soft-archives", async () => {
    const res = await post({ ids, op: "delete" });
    expect(res.status).toBe(200);
    const rows = await prisma.messageVariant.findMany({ where: { id: { in: ids } }, select: { status: true } });
    expect(rows.every((r) => r.status === "archived")).toBe(true);
  });

  it("rejects an unknown op with 400", async () => {
    const res = await post({ ids, op: "frobnicate" });
    expect(res.status).toBe(400);
  });
});
