import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { GET, POST } = await import("@/app/api/push-library/route");

async function seedLibrary() {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
  const cat = await prisma.pushCategory.create({ data: { slug: "giving", label: "Giving" } });
  await prisma.pushSubcategory.create({ data: { categoryId: cat.id, slug: "eoy", label: "EOY" } });
  const agent = await createAgent({ name: "Push Copy Library" });
  const msg = await createMessage(agent.id, { channel: "push" });
  await createVariant(msg.id, { name: "Give Now", title: "Donate today", body: "Year end gift", category: "giving", subcategory: "eoy" });
  await createVariant(msg.id, { name: "Read Verse", title: "John 3:16", body: "For God so loved", category: "reader", subcategory: "specific-verse" });
}

beforeEach(seedLibrary);
afterEach(async () => {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

function get(qs: string) {
  return GET(new Request(`http://t/api/push-library${qs}`) as never);
}

describe("GET /api/push-library search/filter", () => {
  it("keeps the grouped shape when no params are present", async () => {
    const res = await get("");
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0]).toHaveProperty("variants");
  });

  it("returns flat paginated items when q is present", async () => {
    const res = await get("?q=year%20end");
    const { data } = await res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toBe("Give Now");
    expect(data.total).toBe(1);
  });

  it("filters by category", async () => {
    const res = await get("?category=reader");
    const { data } = await res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toBe("Read Verse");
  });

  it("searches the title field case-insensitively", async () => {
    const res = await get("?q=DONATE");
    const { data } = await res.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toBe("Give Now");
  });
});

describe("POST /api/push-library taxonomy validation", () => {
  it("rejects a category absent from the taxonomy with 400", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ name: "X", category: "ghost", title: "T", body: "B" }) }) as never);
    expect(res.status).toBe(400);
  });
  it("rejects a subcategory not belonging to the category with 400", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ name: "X", category: "giving", subcategory: "specific-verse", title: "T", body: "B" }) }) as never);
    expect(res.status).toBe(400);
  });
  it("creates a variant for a valid category+subcategory", async () => {
    const res = await POST(new Request("http://t", { method: "POST", body: JSON.stringify({ name: "X", category: "giving", subcategory: "eoy", title: "T", body: "B" }) }) as never);
    expect(res.status).toBe(201);
  });
});
