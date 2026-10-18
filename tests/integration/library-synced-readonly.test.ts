import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";
import { prisma, assertLocalTestDatabase } from "../helpers/db";
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
  assertLocalTestDatabase("library-synced-readonly.test.ts");
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

const patch = (id: string, body: unknown) =>
  variantRoute.PATCH(new NextRequest("http://t", { method: "PATCH", body: JSON.stringify(body) }), idParams(id));

describe("synced variants: copy is read-only, the kill switch is not", () => {
  it("PATCH of a copy field 409s a synced variant and edits a native one", async () => {
    for (const field of ["body", "title", "name", "subject", "cta", "deeplink", "iconImageUrl"]) {
      const blocked = await patch(syncedId, { [field]: "new" });
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toEqual(LOCKED);
    }
    expect((await prisma.messageVariant.findUnique({ where: { id: syncedId } }))?.body).toBe("B");
    expect((await patch(nativeId, { body: "new" })).status).toBe(200);
  });

  it("PATCH of status / sortOrder on a synced variant is allowed (pause, reorder)", async () => {
    expect((await patch(syncedId, { status: "paused" })).status).toBe(200);
    expect((await prisma.messageVariant.findUnique({ where: { id: syncedId } }))?.status).toBe("paused");
    expect((await patch(syncedId, { sortOrder: 3 })).status).toBe(200);
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

  it("reorder and bulk setStatus / recategorize include synced ids", async () => {
    expect((await reorderRoute.POST(post({ ids: [syncedId, nativeId] }))).status).toBe(200);
    const paused = await bulkRoute.POST(post({ ids: [nativeId, syncedId], op: "setStatus", status: "paused" }));
    expect(paused.status).toBe(200);
    expect((await prisma.messageVariant.findUnique({ where: { id: syncedId } }))?.status).toBe("paused");
    const archived = await bulkRoute.POST(post({ ids: [syncedId], op: "delete" }));
    expect(archived.status).toBe(200);
    expect((await prisma.messageVariant.findUnique({ where: { id: syncedId } }))?.status).toBe("archived");
  });
});

describe("agent clones of a synced variant are read-only too", () => {
  const CLONE_LOCKED = { error: "This variant is a copy of content synced from contentful; edit it at the source." };
  let cloneId: string;
  let nativeCloneId: string;
  beforeEach(async () => {
    const agent = await createAgent({ name: "Sender" });
    const msg = await createMessage(agent.id, { channel: "push" });
    cloneId = (await createVariant(msg.id, { name: "C", title: "T", body: "B" })).id;
    await prisma.messageVariant.update({ where: { id: cloneId }, data: { sourceTemplateId: syncedId } });
    nativeCloneId = (await createVariant(msg.id, { name: "NC", title: "T", body: "B" })).id;
    await prisma.messageVariant.update({ where: { id: nativeCloneId }, data: { sourceTemplateId: nativeId } });
  });

  it("copy PATCH and DELETE 409 with a message naming the template's source", async () => {
    const blocked = await patch(cloneId, { body: "new" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual(CLONE_LOCKED);
    const del = await variantRoute.DELETE(new NextRequest("http://t", { method: "DELETE" }), idParams(cloneId));
    expect(del.status).toBe(409);
    expect(await del.json()).toEqual(CLONE_LOCKED);
    expect((await prisma.messageVariant.findUnique({ where: { id: cloneId } }))?.body).toBe("B");
  });

  it("status PATCH on the clone still works; clones of native templates stay editable", async () => {
    expect((await patch(cloneId, { status: "paused" })).status).toBe(200);
    expect((await patch(nativeCloneId, { body: "new" })).status).toBe(200);
  });
});
