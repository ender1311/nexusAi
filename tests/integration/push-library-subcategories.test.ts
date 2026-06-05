import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { POST } = await import("@/app/api/push-library/subcategories/route");
const { PATCH, DELETE } = await import("@/app/api/push-library/subcategories/[id]/route");

let catId: string;
beforeEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
  const c = await prisma.pushCategory.create({ data: { slug: "giving", label: "Giving" } });
  catId = c.id;
});
afterEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

describe("subcategory CRUD", () => {
  it("creates a subcategory under a category with derived slug", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ categoryId: catId, label: "Year End Appeal" }) }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.slug).toBe("year-end-appeal");
    expect(data.categoryId).toBe(catId);
    expect(data.deeplinkBehavior).toBe("none");
  });

  it("rejects an unknown categoryId with 400", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ categoryId: "nope", label: "X" }) }));
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate slug with 409", async () => {
    await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ categoryId: catId, label: "EOY" }) }));
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ categoryId: catId, label: "eoy" }) }));
    expect(res.status).toBe(409);
  });

  it("PATCH sets deeplinkBehavior and moves to another category", async () => {
    const other = await prisma.pushCategory.create({ data: { slug: "reader", label: "Reader" } });
    const s = await prisma.pushSubcategory.create({ data: { categoryId: catId, slug: "sv", label: "SV" } });
    const res = await PATCH(
      new Request("http://t", { method: "PATCH", body: JSON.stringify({ deeplinkBehavior: "specific-verse", categoryId: other.id }) }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(res.status).toBe(200);
    const fresh = await prisma.pushSubcategory.findUnique({ where: { id: s.id } });
    expect(fresh?.deeplinkBehavior).toBe("specific-verse");
    expect(fresh?.categoryId).toBe(other.id);
  });

  it("PATCH rejects an invalid deeplinkBehavior with 400", async () => {
    const s = await prisma.pushSubcategory.create({ data: { categoryId: catId, slug: "z", label: "Z" } });
    const res = await PATCH(
      new Request("http://t", { method: "PATCH", body: JSON.stringify({ deeplinkBehavior: "teleport" }) }),
      { params: Promise.resolve({ id: s.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("DELETE blocks (409) when a variant still references the subcategory slug", async () => {
    const s = await prisma.pushSubcategory.create({ data: { categoryId: catId, slug: "inuse", label: "In Use" } });
    const agent = await createAgent({ name: "Push Copy Library" });
    const msg = await createMessage(agent.id, { channel: "push" });
    await createVariant(msg.id, { category: "giving", subcategory: "inuse" });
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), { params: Promise.resolve({ id: s.id }) });
    expect(res.status).toBe(409);
  });

  it("DELETE removes an unused subcategory", async () => {
    const s = await prisma.pushSubcategory.create({ data: { categoryId: catId, slug: "free", label: "Free" } });
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), { params: Promise.resolve({ id: s.id }) });
    expect(res.status).toBe(200);
    expect(await prisma.pushSubcategory.findUnique({ where: { id: s.id } })).toBeNull();
  });
});
