// tests/integration/content-sync.test.ts
import { beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import { syncContentSource } from "@/connectors/content/sync";
import { saveContentSourceConfig } from "@/connectors/content/config";
import type { ContentSource, ListPage } from "@/connectors/content/types";
import type { ContentItem } from "@/lib/content-core";

const item = (ref: string, body = `Body ${ref}`): ContentItem => ({ externalRef: ref, channel: "push", body, title: `T ${ref}`, tags: [], updatedAt: "2026-10-01T00:00:00Z", locales: { es: { body: `ES ${ref}` } } });
function fakeSource(pages: (ListPage | Error)[]): ContentSource {
  let i = 0;
  return { id: "contentful", activation: "inline", testConnection: async () => ({ ok: true, sample: [] }),
    listItems: async () => { const p = pages[i++]!; if (p instanceof Error) throw p; return p; } };
}

describe("syncContentSource", () => {
  beforeEach(async () => {
    await truncateAll();
    await saveContentSourceConfig({ enabled: ["nexus-library", "contentful"], contentful: { spaceId: "s", environment: "master", contentType: "t", channel: "push", mapping: {} } });
  });

  it("creates variants under one library message, with translations, and records a run", async () => {
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a")], skipped: [], next: "1" }, { items: [item("b")], skipped: [{ externalRef: "bad", error: "bad: invalid body" }] }]) });
    expect(r).toMatchObject({ status: "partial", created: 2, updated: 0, archived: 0, skipped: 1 });
    const vs = await prisma.messageVariant.findMany({ where: { contentSource: "contentful" }, include: { message: true, translations: true } });
    expect(vs.map((v) => v.externalRef).sort()).toEqual(["a", "b"]);
    expect(new Set(vs.map((v) => v.messageId)).size).toBe(1);
    expect(vs[0]!.message.agentId).toBeNull();
    expect(vs[0]!.message.contentSource).toBe("contentful");
    expect(vs.find((v) => v.externalRef === "a")!.translations[0]).toMatchObject({ body: "ES a" });
    expect(await prisma.contentSyncRun.count()).toBe(1);
  });

  it("is idempotent and updates changed copy", async () => {
    await syncContentSource("contentful", { source: fakeSource([{ items: [item("a")], skipped: [] }]) });
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a", "New body")], skipped: [] }]) });
    expect(r).toMatchObject({ status: "ok", created: 0, updated: 1 });
    expect((await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "a" } })).body).toBe("New body");
    const again = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a", "New body")], skipped: [] }]) });
    expect(again).toMatchObject({ created: 0, updated: 0 });
  });

  it("archives variants missing from a complete listing, never deletes", async () => {
    await syncContentSource("contentful", { source: fakeSource([{ items: [item("a"), item("b")], skipped: [] }]) });
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a")], skipped: [] }]) });
    expect(r.archived).toBe(1);
    expect((await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "b" } })).status).toBe("archived");
  });

  it("recreated entry archives old, creates new", async () => {
    await syncContentSource("contentful", { source: fakeSource([{ items: [item("old")], skipped: [] }]) });
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("new")], skipped: [] }]) });
    expect(r).toMatchObject({ created: 1, archived: 1 });
  });

  it("failed listing archives nothing and records the error", async () => {
    await syncContentSource("contentful", { source: fakeSource([{ items: [item("a"), item("b")], skipped: [] }]) });
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a")], skipped: [], next: "1" }, new Error("Contentful responded 503")]) });
    expect(r.status).toBe("failed");
    expect(r.archived).toBe(0);
    expect(r.errors[0]!.message).toContain("503");
    expect((await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "b" } })).status).toBe("active");
  });

  it("an overlapping run for the same source is skipped as locked", async () => {
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((res) => { markStarted = res; });
    const slow: ContentSource = { id: "contentful", activation: "inline", testConnection: async () => ({ ok: true, sample: [] }),
      listItems: () => new Promise((res) => { release = () => res({ items: [item("a")], skipped: [] }); markStarted(); }) };
    const first = syncContentSource("contentful", { source: slow });
    await started; // first run holds the lock once listItems is entered
    const second = await syncContentSource("contentful", { source: fakeSource([{ items: [], skipped: [] }]) });
    expect(second).toMatchObject({ status: "skipped", reason: "locked" });
    release();
    expect((await first).status).toBe("ok");
  });

  it("a disabled source is skipped", async () => {
    expect(await syncContentSource("sanity", { source: fakeSource([]) })).toMatchObject({ status: "skipped", reason: "not-enabled" });
  });
});
