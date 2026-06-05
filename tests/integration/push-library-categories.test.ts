import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { prisma } from "../helpers/db";

mock.module("@/lib/auth", () => ({
  requireLibraryEditor: async () => null,
  requireAdmin: async () => null,
}));
mock.module("next/cache", () => ({ revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { GET, POST } = await import("@/app/api/push-library/categories/route");
const { PATCH, DELETE } = await import("@/app/api/push-library/categories/[id]/route");

beforeEach(async () => {
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});
afterEach(async () => {
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

function req(body: unknown) {
  return new Request("http://t", { method: "POST", body: JSON.stringify(body) });
}

describe("category CRUD", () => {
  it("creates a category with a derived slug", async () => {
    const res = await POST(req({ label: "Holiday Pushes" }));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.slug).toBe("holiday-pushes");
    expect(data.label).toBe("Holiday Pushes");
  });

  it("rejects a duplicate slug with 409", async () => {
    await POST(req({ label: "Giving" }));
    const res = await POST(req({ label: "giving" }));
    expect(res.status).toBe(409);
  });

  it("rejects an empty label with 400", async () => {
    const res = await POST(req({ label: "   " }));
    expect(res.status).toBe(400);
  });

  it("GET returns categories ordered by sortOrder", async () => {
    await prisma.pushCategory.create({ data: { slug: "b", label: "B", sortOrder: 1 } });
    await prisma.pushCategory.create({ data: { slug: "a", label: "A", sortOrder: 0 } });
    const res = await GET();
    const { data } = await res.json();
    expect(data.map((c: { slug: string }) => c.slug)).toEqual(["a", "b"]);
  });

  it("PATCH updates label/sortOrder/isActive but not slug", async () => {
    const c = await prisma.pushCategory.create({ data: { slug: "x", label: "X" } });
    const res = await PATCH(
      new Request("http://t", { method: "PATCH", body: JSON.stringify({ label: "X2", slug: "hacked", isActive: false }) }),
      { params: Promise.resolve({ id: c.id }) },
    );
    expect(res.status).toBe(200);
    const fresh = await prisma.pushCategory.findUnique({ where: { id: c.id } });
    expect(fresh?.label).toBe("X2");
    expect(fresh?.slug).toBe("x");
    expect(fresh?.isActive).toBe(false);
  });

  it("DELETE blocks (409) a category that still has subcategories", async () => {
    const c = await prisma.pushCategory.create({ data: { slug: "c", label: "C" } });
    await prisma.pushSubcategory.create({ data: { categoryId: c.id, slug: "s", label: "S" } });
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), { params: Promise.resolve({ id: c.id }) });
    expect(res.status).toBe(409);
  });

  it("DELETE removes an empty category", async () => {
    const c = await prisma.pushCategory.create({ data: { slug: "d", label: "D" } });
    const res = await DELETE(new Request("http://t", { method: "DELETE" }), { params: Promise.resolve({ id: c.id }) });
    expect(res.status).toBe(200);
    expect(await prisma.pushCategory.findUnique({ where: { id: c.id } })).toBeNull();
  });
});
