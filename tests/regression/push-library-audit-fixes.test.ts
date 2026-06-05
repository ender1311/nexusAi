// Regression tests for the 2026-06-05 push-library audit fixes:
//   #1 category DELETE must 409 when MessageVariants still reference its slug
//      (previously only subcategories were guarded, so deleting a category with
//      live pushes orphaned them into the "uncategorized" bucket).
//   #2 ?status=... must return the paginated shape ({items,total,nextCursor}),
//      not the grouped shape — "status" was missing from FILTER_PARAMS.
//   #3 bulk setStatus must reject statuses outside the allowed set (previously
//      any non-empty string was written verbatim to every selected variant).
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const LIBRARY_AGENT_NAME = "Push Copy Library";

const { DELETE } = await import("@/app/api/push-library/categories/[id]/route");
const { GET } = await import("@/app/api/push-library/route");
const { POST: BULK } = await import("@/app/api/push-library/bulk/route");

async function cleanup() {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
}
beforeEach(cleanup);
afterEach(cleanup);

describe("push-library audit fixes", () => {
  it("#1 blocks category DELETE (409) when variants still reference its slug", async () => {
    const cat = await prisma.pushCategory.create({ data: { slug: "giving", label: "Giving" } });
    const agent = await createAgent({ name: LIBRARY_AGENT_NAME });
    const msg = await createMessage(agent.id, { channel: "push" });
    await createVariant(msg.id, { name: "A", title: "A", body: "a", category: "giving" });

    const res = await DELETE(new NextRequest("http://t", { method: "DELETE" }), {
      params: Promise.resolve({ id: cat.id }),
    });
    expect(res.status).toBe(409);
    expect(await prisma.pushCategory.findUnique({ where: { id: cat.id } })).not.toBeNull();
  });

  it("#1 allows category DELETE once no variants reference it", async () => {
    const cat = await prisma.pushCategory.create({ data: { slug: "empty", label: "Empty" } });
    const res = await DELETE(new NextRequest("http://t", { method: "DELETE" }), {
      params: Promise.resolve({ id: cat.id }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.pushCategory.findUnique({ where: { id: cat.id } })).toBeNull();
  });

  it("#2 returns the paginated shape when only status is filtered", async () => {
    const agent = await createAgent({ name: LIBRARY_AGENT_NAME });
    const msg = await createMessage(agent.id, { channel: "push" });
    await createVariant(msg.id, { name: "Live", title: "T", body: "b", status: "active" });
    await createVariant(msg.id, { name: "Gone", title: "T", body: "b", status: "archived" });

    const res = await GET(new NextRequest("http://t/api/push-library?status=archived"));
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(false);
    expect(data).toHaveProperty("items");
    expect(data).toHaveProperty("total");
    expect(data).toHaveProperty("nextCursor");
    expect(data.items.every((v: { status: string }) => v.status === "archived")).toBe(true);
  });

  it("#3 rejects bulk setStatus with a status outside the allowed set", async () => {
    const agent = await createAgent({ name: LIBRARY_AGENT_NAME });
    const msg = await createMessage(agent.id, { channel: "push" });
    const v = await createVariant(msg.id, { name: "A", title: "A", body: "a", status: "active" });

    const res = await BULK(
      new NextRequest("http://t", { method: "POST", body: JSON.stringify({ ids: [v.id], op: "setStatus", status: "activ" }) }),
    );
    expect(res.status).toBe(400);
    const fresh = await prisma.messageVariant.findUnique({ where: { id: v.id } });
    expect(fresh?.status).toBe("active");
  });

  it("#3 still accepts a whitelisted status", async () => {
    const agent = await createAgent({ name: LIBRARY_AGENT_NAME });
    const msg = await createMessage(agent.id, { channel: "push" });
    const v = await createVariant(msg.id, { name: "A", title: "A", body: "a", status: "active" });

    const res = await BULK(
      new NextRequest("http://t", { method: "POST", body: JSON.stringify({ ids: [v.id], op: "setStatus", status: "paused" }) }),
    );
    expect(res.status).toBe(200);
    const fresh = await prisma.messageVariant.findUnique({ where: { id: v.id } });
    expect(fresh?.status).toBe("paused");
  });
});
