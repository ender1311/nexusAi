import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { PATCH } = await import("@/app/api/variants/[id]/route");

let variantId: string;
beforeEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
  const reader = await prisma.pushCategory.create({ data: { slug: "reader", label: "Reader" } });
  await prisma.pushSubcategory.create({ data: { categoryId: reader.id, slug: "open-bible", label: "Open Bible" } });
  const giving = await prisma.pushCategory.create({ data: { slug: "giving", label: "Giving" } });
  await prisma.pushSubcategory.create({ data: { categoryId: giving.id, slug: "eoy", label: "EOY" } });
  const agent = await createAgent({ name: "Push Copy Library" });
  const msg = await createMessage(agent.id, { channel: "push" });
  const v = await createVariant(msg.id, { title: "T", body: "B", category: "reader", subcategory: "open-bible" });
  variantId = v.id;
});
afterEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

function patch(id: string, body: unknown) {
  return PATCH(new NextRequest("http://t", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}

describe("variant recategorization", () => {
  it("recategorizes to a new category + subcategory", async () => {
    const res = await patch(variantId, { category: "giving", subcategory: "eoy" });
    expect(res.status).toBe(200);
    const fresh = await prisma.messageVariant.findUnique({ where: { id: variantId } });
    expect(fresh?.category).toBe("giving");
    expect(fresh?.subcategory).toBe("eoy");
  });

  it("rejects a subcategory that does not belong to the resulting category (400)", async () => {
    const res = await patch(variantId, { category: "giving", subcategory: "open-bible" });
    expect(res.status).toBe(400);
    const fresh = await prisma.messageVariant.findUnique({ where: { id: variantId } });
    expect(fresh?.category).toBe("reader");
  });

  it("updates sortOrder", async () => {
    const res = await patch(variantId, { sortOrder: 5 });
    expect(res.status).toBe(200);
    const fresh = await prisma.messageVariant.findUnique({ where: { id: variantId } });
    expect(fresh?.sortOrder).toBe(5);
  });
});
