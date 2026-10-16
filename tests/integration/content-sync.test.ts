// tests/integration/content-sync.test.ts
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import { archiveMissing, syncContentSource } from "@/connectors/content/sync";
import { saveContentSourceConfig } from "@/connectors/content/config";
import { ContentSourceError, type ContentSource, type ListPage } from "@/connectors/content/types";
import type { ContentItem } from "@/lib/content-core";

const item = (ref: string, body = `Body ${ref}`): ContentItem => ({ externalRef: ref, channel: "push", body, title: `T ${ref}`, tags: [], updatedAt: "2026-10-01T00:00:00Z", locales: { es: { body: `ES ${ref}` } } });
function fakeSource(pages: (ListPage | Error)[]): ContentSource {
  let i = 0;
  return { id: "contentful", activation: "inline", testConnection: async () => ({ ok: true, sample: [] }),
    listItems: async () => { const p = pages[i++]!; if (p instanceof Error) throw p; return p; } };
}

describe("syncContentSource", () => {
  // Sync logs the real error server-side; keep test output quiet.
  let consoleError: ReturnType<typeof spyOn> | undefined;
  beforeEach(() => { consoleError = spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => consoleError?.mockRestore());

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
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a")], skipped: [], next: "1" }, new ContentSourceError("Contentful responded 503")]) });
    expect(r.status).toBe("failed");
    expect(r.archived).toBe(0);
    expect(r.errors[0]).toEqual({ externalRef: "(listing)", message: "Contentful responded 503" });
    expect((await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "b" } })).status).toBe("active");
  });

  it("an unexpected listing throw is stored as a generic message, never the raw text", async () => {
    const r = await syncContentSource("contentful", { source: fakeSource([new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2")]) });
    expect(r.status).toBe("failed");
    expect(r.errors).toEqual([{ externalRef: "(listing)", message: "Source request failed" }]);
    const run = await prisma.contentSyncRun.findFirstOrThrow();
    expect(JSON.stringify(run.errors)).not.toContain("hunter2");
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

  const emailItem = (ref: string): ContentItem => ({ ...item(ref), channel: "email", subject: `S ${ref}` });
  const ok = (items: ContentItem[], next?: string): ListPage => ({ items, skipped: [], next });

  it("never archives native nexus-library variants", async () => {
    const msg = await prisma.message.create({ data: { name: "native", channel: "push" } });
    await prisma.messageVariant.create({ data: { messageId: msg.id, name: "n", body: "native body" } });
    expect(await syncContentSource("nexus-library", { source: fakeSource([ok([])]) })).toMatchObject({ status: "skipped", reason: "not-syncable" });
    expect(await prisma.messageVariant.count({ where: { status: "active" } })).toBe(1);
  });

  it("archive ignores native variants (externalRef null) of other sources", async () => {
    const msg = await prisma.message.create({ data: { name: "native", channel: "push" } });
    await prisma.messageVariant.create({ data: { messageId: msg.id, name: "n", body: "native body", contentSource: "contentful" } });
    await syncContentSource("contentful", { source: fakeSource([ok([item("a")])]) });
    expect(await prisma.messageVariant.count({ where: { externalRef: null, status: "active" } })).toBe(1);
  });

  it("a channel change moves the variant to the other library message, keeping its id", async () => {
    await syncContentSource("contentful", { source: fakeSource([ok([item("a")])]) });
    const before = await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "a" } });
    const r = await syncContentSource("contentful", { source: fakeSource([ok([emailItem("a")])]) });
    expect(r).toMatchObject({ created: 0, updated: 1 });
    const after = await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "a" }, include: { message: true } });
    expect(after.id).toBe(before.id);
    expect(after.message.channel).toBe("email");
    expect(after.messageId).not.toBe(before.messageId);
  });

  it("archives only missing items across channels", async () => {
    await syncContentSource("contentful", { source: fakeSource([ok([item("p1"), item("p2"), emailItem("e1"), emailItem("e2")])]) });
    const r = await syncContentSource("contentful", { source: fakeSource([ok([item("p1"), emailItem("e2")])]) });
    expect(r.archived).toBe(2);
    const rows = await prisma.messageVariant.findMany({ where: { contentSource: "contentful" } });
    expect(Object.fromEntries(rows.map((v) => [v.externalRef, v.status]))).toEqual({ p1: "active", p2: "archived", e1: "archived", e2: "active" });
  });

  it("a translation-only change counts as updated", async () => {
    await syncContentSource("contentful", { source: fakeSource([ok([item("a")])]) });
    const changed = { ...item("a"), locales: { es: { body: "ES nuevo" } } };
    const r = await syncContentSource("contentful", { source: fakeSource([ok([changed])]) });
    expect(r).toMatchObject({ created: 0, updated: 1 });
    expect((await prisma.messageVariantTranslation.findFirstOrThrow({ where: { language: "es" } })).body).toBe("ES nuevo");
  });

  it("a locale removed at the source deletes its translation row", async () => {
    await syncContentSource("contentful", { source: fakeSource([ok([{ ...item("a"), locales: { es: { body: "ES a" }, fr: { body: "FR a" } } }])]) });
    const r = await syncContentSource("contentful", { source: fakeSource([ok([{ ...item("a"), locales: { fr: { body: "FR a" } } }])]) });
    expect(r).toMatchObject({ created: 0, updated: 1 });
    const rows = await prisma.messageVariantTranslation.findMany();
    expect(rows.map((t) => t.language)).toEqual(["fr"]);
  });

  it("a copy change keeps an operator's pause on the synced variant", async () => {
    await syncContentSource("contentful", { source: fakeSource([ok([item("a")])]) });
    await prisma.messageVariant.updateMany({ where: { externalRef: "a" }, data: { status: "paused" } });
    await syncContentSource("contentful", { source: fakeSource([ok([item("a", "New body")])]) });
    expect(await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "a" } })).toMatchObject({ body: "New body", status: "paused" });
  });

  it("writes Nexus channel names on library messages", async () => {
    const as = (ref: string, channel: ContentItem["channel"]): ContentItem => ({ ...item(ref), channel });
    await syncContentSource("contentful", { source: fakeSource([ok([as("p", "push"), as("e", "email"), as("c", "content_card"), as("s", "slideup"), as("m", "modal")])]) });
    const vs = await prisma.messageVariant.findMany({ where: { contentSource: "contentful" }, include: { message: true } });
    expect(Object.fromEntries(vs.map((v) => [v.externalRef, v.message.channel]))).toEqual({
      p: "push", e: "email", c: "content-card", s: "in-app", m: "modal-iam",
    });
  });

  it("refuses to archive everything when a complete listing is empty", async () => {
    await syncContentSource("contentful", { source: fakeSource([ok([item("a")])]) });
    const r = await syncContentSource("contentful", { source: fakeSource([ok([])]) });
    expect(r).toMatchObject({ status: "partial", archived: 0 });
    expect(r.errors[0]!.message).toContain("refusing to archive");
    expect((await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "a" } })).status).toBe("active");
  });

  it("hitting the page limit is partial and archives nothing", async () => {
    await syncContentSource("contentful", { source: fakeSource([ok([item("a"), item("b")])]) });
    const endless: ContentSource = { id: "contentful", activation: "inline", testConnection: async () => ({ ok: true, sample: [] }),
      listItems: async () => ok([item("a")], "more") };
    const r = await syncContentSource("contentful", { source: endless, maxPages: 3 });
    expect(r.status).toBe("partial");
    expect(r.archived).toBe(0);
    expect(r.errors.map((e) => e.message)).toContain("page limit reached");
    expect((await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "b" } })).status).toBe("active");
  });

  it("takes over a stale running lease", async () => {
    const stale = await prisma.contentSyncRun.create({ data: { source: "contentful", status: "running", startedAt: new Date(Date.now() - 20 * 60_000) } });
    const r = await syncContentSource("contentful", { source: fakeSource([ok([item("a")])]) });
    expect(r.status).toBe("ok");
    const old = await prisma.contentSyncRun.findUniqueOrThrow({ where: { id: stale.id } });
    expect(old.status).toBe("failed");
    expect(old.finishedAt).not.toBeNull();
  });

  it("a fresh running lease blocks and is left alone", async () => {
    await prisma.contentSyncRun.create({ data: { source: "contentful", status: "running" } });
    expect(await syncContentSource("contentful", { source: fakeSource([ok([item("a")])]) })).toMatchObject({ status: "skipped", reason: "locked" });
  });

  it("a database error keeps earlier pages, marks the run failed and finalizes it", async () => {
    const bad = { ...item("bad"), body: "nul\u0000byte" };
    const r = await syncContentSource("contentful", { source: fakeSource([ok([item("a")], "1"), ok([bad])]) });
    expect(r.status).toBe("failed");
    expect(r.created).toBe(1);
    expect(r.archived).toBe(0);
    expect(r.errors[0]).toEqual({ externalRef: "(database)", message: "Database error while saving items" });
    const stored = await prisma.contentSyncRun.findFirstOrThrow();
    expect(JSON.stringify(stored.errors)).not.toMatch(/nul|invalid byte|0x00|prisma/i);
    expect(await prisma.messageVariant.count({ where: { externalRef: "a" } })).toBe(1);
    const run = await prisma.contentSyncRun.findFirstOrThrow();
    expect(run.status).toBe("failed");
    expect(run.finishedAt).not.toBeNull();
  });

  it("archiveMissing handles 70k seen refs (single array parameter)", async () => {
    await syncContentSource("contentful", { source: fakeSource([ok([item("keep"), item("drop")])]) });
    const seen = ["keep", ...Array.from({ length: 70_000 }, (_, n) => `ref-${n}`)];
    expect(await archiveMissing("contentful", seen)).toEqual({ variants: 1, clones: 0 });
    expect((await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "keep" } })).status).toBe("active");
  });
});
