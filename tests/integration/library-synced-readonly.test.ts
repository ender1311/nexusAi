import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";
import { prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

mock.module("@/lib/auth", () => ({ requireLibraryEditor: async () => null, requireAdmin: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const variantRoute = await import("@/app/api/variants/[id]/route");
const libraryRoute = await import("@/app/api/push-library/[id]/route");
const reorderRoute = await import("@/app/api/push-library/reorder/route");
const bulkRoute = await import("@/app/api/push-library/bulk/route");

const LOCKED = { error: "This variant is synced from contentful; edit it at the source." };
let syncedId: string;
let nativeId: string;

async function cleanup() {
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agent.deleteMany();
}
beforeEach(async () => {
  await cleanup();
  const agent = await createAgent({ name: "Push Copy Library" });
  const msg = await createMessage(agent.id, { channel: "push" });
  const synced = await createVariant(msg.id, { name: "S", title: "T", body: "B" });
  await prisma.messageVariant.update({ where: { id: synced.id }, data: { contentSource: "contentful", externalRef: "e1" } });
  syncedId = synced.id;
  nativeId = (await createVariant(msg.id, { name: "N", title: "T", body: "B" })).id;
});
afterEach(cleanup);

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new NextRequest("http://t", { method: "POST", body: JSON.stringify(body) });

describe("synced variants are read-only in the library routes", () => {
  it("PATCH /api/variants/[id] 409s a synced variant and edits a native one", async () => {
    const blocked = await variantRoute.PATCH(new NextRequest("http://t", { method: "PATCH", body: JSON.stringify({ body: "new" }) }), idParams(syncedId));
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual(LOCKED);
    expect((await prisma.messageVariant.findUnique({ where: { id: syncedId } }))?.body).toBe("B");

    const allowed = await variantRoute.PATCH(new NextRequest("http://t", { method: "PATCH", body: JSON.stringify({ body: "new" }) }), idParams(nativeId));
    expect(allowed.status).toBe(200);
  });

  it("DELETE /api/variants/[id] 409s a synced variant and deletes a native one", async () => {
    const blocked = await variantRoute.DELETE(new NextRequest("http://t", { method: "DELETE" }), idParams(syncedId));
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual(LOCKED);
    expect(await prisma.messageVariant.count({ where: { id: syncedId } })).toBe(1);

    expect((await variantRoute.DELETE(new NextRequest("http://t", { method: "DELETE" }), idParams(nativeId))).status).toBe(200);
  });

  it("DELETE /api/push-library/[id] 409s a synced variant", async () => {
    const res = await libraryRoute.DELETE(new NextRequest("http://t", { method: "DELETE" }), idParams(syncedId));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(LOCKED);
  });

  it("POST /api/push-library/reorder 409s when any id is synced", async () => {
    const res = await reorderRoute.POST(post({ ids: [nativeId, syncedId] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(LOCKED);
  });

  it("POST /api/push-library/bulk 409s when any id is synced, and works for native ids", async () => {
    const res = await bulkRoute.POST(post({ ids: [nativeId, syncedId], op: "setStatus", status: "paused" }));
    expect(res.status).toBe(409);
    expect((await prisma.messageVariant.findUnique({ where: { id: nativeId } }))?.status).not.toBe("paused");

    const ok = await bulkRoute.POST(post({ ids: [nativeId], op: "setStatus", status: "paused" }));
    expect(ok.status).toBe(200);
  });
});
