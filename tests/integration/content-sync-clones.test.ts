// Agents send library content only through clones (POST /api/agents/[id]/messages with a
// sourceTemplateId). Clones of synced variants must follow their template: copy, archive, catalog ref.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import { createAgent } from "../helpers/builders";
import { FakeFetch } from "../helpers/braze";

mock.module("@/lib/auth", () => ({ requireAdmin: async () => null, requireLibraryEditor: async () => null }));
mock.module("next/cache", () => ({ revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { syncContentSource } = await import("@/connectors/content/sync");
const { saveContentSourceConfig } = await import("@/connectors/content/config");
const messagesRoute = await import("@/app/api/agents/[id]/messages/route");
const contentCardLibrary = await import("@/app/api/content-card-library/route");
const { catalogItemIdFor } = await import("@/lib/content-core");
const { groupDecisionsByVariant, sendVariantGroup } = await import("@/lib/cron/send-grouping");
const { createBrazeClient } = await import("@/lib/braze/client");
const { PayloadFactory } = await import("@/lib/braze/payload-factory");

import type { ContentSource, ListPage } from "@/connectors/content/types";
import type { ContentItem } from "@/lib/content-core";
import type { ContentSourceId } from "@/connectors/content/config";

const item = (ref: string, over: Partial<ContentItem> = {}): ContentItem => ({
  externalRef: ref, channel: "push", title: `T ${ref}`, body: `Body ${ref}`, tags: [], updatedAt: "2026-10-01T00:00:00Z",
  locales: { es: { title: `ES T ${ref}`, body: `ES ${ref}` } }, ...over,
});
const source = (id: ContentSourceId, items: ContentItem[]): ContentSource => ({
  id, activation: id === "braze-catalog" ? "reference" : "inline", testConnection: async () => ({ ok: true, sample: [] }),
  listItems: async (): Promise<ListPage> => ({ items, skipped: [] }),
});
const sync = (id: ContentSourceId, items: ContentItem[]) => syncContentSource(id, { source: source(id, items) });

/** Clones a library variant into an agent through the real messages route, as the picker does. */
async function cloneIntoAgent(agentId: string, channel: string, templateId: string): Promise<string> {
  const template = await prisma.messageVariant.findUniqueOrThrow({ where: { id: templateId } });
  const res = await messagesRoute.POST(
    new NextRequest("http://t", { method: "POST", body: JSON.stringify({
      name: "Agent message", channel,
      variants: [{ name: "My clone", title: template.title, body: template.body, cta: template.cta, deeplink: template.deeplink, sourceTemplateId: templateId }],
    }) }),
    { params: Promise.resolve({ id: agentId }) },
  );
  expect(res.status).toBe(201);
  const message = await res.json() as { variants: { id: string }[] };
  return message.variants[0]!.id;
}

/** The variant include select-and-send uses: only active variants are candidates. */
const cronCandidates = (agentId: string) => prisma.agent.findMany({
  where: { id: agentId },
  include: { messages: { include: { variants: { where: { status: "active" } } } } },
}).then((agents) => agents.flatMap((a) => a.messages.flatMap((m) => m.variants.map((v) => v.id))));

describe("clones of synced variants", () => {
  let agentId: string;
  let consoleInfo: ReturnType<typeof spyOn>;
  beforeAll(() => { consoleInfo = spyOn(console, "info").mockImplementation(() => {}); });
  afterAll(() => consoleInfo.mockRestore());
  beforeEach(async () => {
    await truncateAll();
    await saveContentSourceConfig({
      enabled: ["nexus-library", "contentful", "braze-catalog"],
      contentful: { spaceId: "s", environment: "master", contentType: "t", channel: "push", mapping: {} },
      brazeCatalog: { catalogName: "lumen_tips", channel: "content_card", mapping: {} },
    });
    agentId = (await createAgent({ name: "Sender" })).id;
  });

  it("a copy change at the source reaches the clone (name kept, translations upserted, removed locales deleted)", async () => {
    await sync("contentful", [item("a")]);
    const template = await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "a" } });
    const cloneId = await cloneIntoAgent(agentId, "push", template.id);
    expect((await prisma.messageVariant.findUniqueOrThrow({ where: { id: cloneId } })).contentSource).toBe("nexus-library");

    const r = await sync("contentful", [item("a", { body: "New body", title: "New title", locales: { fr: { body: "FR new" } } })]);
    expect(r).toMatchObject({ updated: 1, propagated: 1 });
    const clone = await prisma.messageVariant.findUniqueOrThrow({ where: { id: cloneId }, include: { translations: true } });
    expect(clone).toMatchObject({ name: "My clone", body: "New body", title: "New title", status: "active" });
    expect(clone.translations.map((t) => [t.language, t.body])).toEqual([["fr", "FR new"]]);
    const templateRows = await prisma.messageVariantTranslation.findMany({ where: { messageVariantId: template.id } });
    expect(templateRows.map((t) => t.language)).toEqual(["fr"]);
  });

  it("removed at the source: the clone is archived and drops out of the cron's candidates; restored: it comes back", async () => {
    await sync("contentful", [item("a"), item("keep")]);
    const template = await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "a" } });
    const cloneId = await cloneIntoAgent(agentId, "push", template.id);
    expect(await cronCandidates(agentId)).toEqual([cloneId]);

    const removed = await sync("contentful", [item("keep")]);
    expect(removed).toMatchObject({ archived: 1, propagated: 1 });
    expect((await prisma.messageVariant.findUniqueOrThrow({ where: { id: cloneId } })).status).toBe("archived");
    expect(await cronCandidates(agentId)).toEqual([]);

    await sync("contentful", [item("a"), item("keep")]);
    expect((await prisma.messageVariant.findUniqueOrThrow({ where: { id: cloneId } })).status).toBe("active");
  });

  it("a clone paused in its agent stays paused when the source copy changes", async () => {
    await sync("contentful", [item("a")]);
    const template = await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "a" } });
    const cloneId = await cloneIntoAgent(agentId, "push", template.id);
    await prisma.messageVariant.update({ where: { id: cloneId }, data: { status: "paused" } });
    await sync("contentful", [item("a", { body: "New body" })]);
    expect(await prisma.messageVariant.findUniqueOrThrow({ where: { id: cloneId } })).toMatchObject({ body: "New body", status: "paused" });
  });

  it("a synced content_card item is listed by the content-card library API", async () => {
    await sync("braze-catalog", [item("tip_7", { channel: "content_card", title: "Breathe" })]);
    const res = await contentCardLibrary.GET(new NextRequest("http://t/api/content-card-library"));
    const { data } = await res.json() as { data: { variants: { title: string }[] }[] };
    expect(data.flatMap((g) => g.variants.map((v) => v.title))).toEqual(["Breathe"]);
  });

  describe("a braze-catalog clone sends catalog_item_id", () => {
    const ENV: Record<string, string> = {
      BRAZE_API_KEY: "test_key", BRAZE_REST_ENDPOINT: "https://rest.test.braze.com",
      BRAZE_NEXUS_CAMPAIGN_ID: "nexus-campaign", BRAZE_CONTENT_CARD_CAMPAIGN_ID: "cc-campaign",
    };
    const saved: Record<string, string | undefined> = {};
    let fake: FakeFetch;
    let originalFetch: typeof globalThis.fetch;
    beforeAll(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; } });
    afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
    beforeEach(() => { fake = new FakeFetch(); originalFetch = globalThis.fetch; globalThis.fetch = fake.fetch as typeof fetch; });
    afterEach(() => { globalThis.fetch = originalFetch; });

    it("resolves the template's ref the way select-and-send does and puts it in trigger_properties", async () => {
      await sync("braze-catalog", [item("tip_7", { channel: "content_card", title: "Breathe", body: "Two minutes." })]);
      const template = await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "tip_7" } });
      const cloneId = await cloneIntoAgent(agentId, "content-card", template.id);
      const clone = await prisma.messageVariant.findUniqueOrThrow({ where: { id: cloneId } });

      // Same lookup as the cron: braze-catalog templates of the agent's clones, batched by id.
      const templates = new Map((await prisma.messageVariant.findMany({
        where: { id: { in: [clone.sourceTemplateId!] }, contentSource: "braze-catalog" },
        select: { id: true, contentSource: true, externalRef: true },
      })).map((t) => [t.id, t]));
      const catalogItemId = catalogItemIdFor(clone, templates.get(clone.sourceTemplateId!));
      expect(catalogItemId).toBe("tip_7");

      const meta = { channel: "content-card", body: clone.body, title: clone.title, cta: null, deeplink: null,
        brazeCampaignId: null, brazeVariantId: null, catalogItemId, givingHandleStrategy: null, iconImageUrl: null };
      const groups = groupDecisionsByVariant(
        [{ user: { externalId: "u1", brazeId: null, attributes: {} }, variantId: cloneId, scheduledAt: new Date(), inLocalTime: false }],
        new Map([[cloneId, meta]]), new Map([["u1", "d1"]]),
      );
      const [group] = Object.values(groups);
      const prismaStub = {
        userDecision: { updateMany: async () => ({ count: 1 }) },
        failedBrazeSend: { create: async () => ({}) },
      } as unknown as typeof prisma;
      await sendVariantGroup(group!, group!.externalUserIds, group!.decisionIds, createBrazeClient(), new PayloadFactory(), agentId, prismaStub);
      const props = (fake.requests[0]!.body as { trigger_properties: Record<string, string> }).trigger_properties;
      expect(props).toMatchObject({ catalog_item_id: "tip_7", title: "Breathe", message: "Two minutes." });
    });
  });
});
