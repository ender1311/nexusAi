import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

// Call the route handlers directly (the WorkOS session is stubbed as an admin in
// tests/setup/bun.ts) instead of fetching a dev server on localhost:3000.
const route = await import("@/app/api/content-card-library/route");
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/content-card-library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Integration tests for /api/content-card-library route.
// Verifies the library message + variant lifecycle against the real handlers.

let messageId: string;
let variantId: string;

beforeAll(async () => {
  // Clean up any leftover test records
  const existing = await prisma.message.findFirst({
    where: { agentId: null, channel: "content-card", name: "__test_cc_library__" },
  });
  if (existing) {
    await prisma.message.delete({ where: { id: existing.id } });
  }

  const message = await prisma.message.create({
    data: { agentId: null, name: "__test_cc_library__", channel: "content-card" },
  });
  messageId = message.id;

  const variant = await prisma.messageVariant.create({
    data: {
      messageId,
      name: "Giving Appeal Card",
      title: "Every Bible changes a life",
      body: "Your gift helps provide free access to the Bible for millions.",
      cta: "Give Now",
      deeplink: "https://give.youversion.com",
      category: "giving",
      subcategory: "appeal",
      status: "active",
    },
  });
  variantId = variant.id;
});

afterAll(async () => {
  await prisma.message.delete({ where: { id: messageId } });
});

describe("content-card library DB model", () => {
  it("creates a library variant with content card fields", async () => {
    const v = await prisma.messageVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(v.title).toBe("Every Bible changes a life");
    expect(v.body).toBe("Your gift helps provide free access to the Bible for millions.");
    expect(v.cta).toBe("Give Now");
    expect(v.deeplink).toBe("https://give.youversion.com");
    expect(v.category).toBe("giving");
    expect(v.subcategory).toBe("appeal");
    expect(v.status).toBe("active");
  });

  it("library variant is agentId null and channel content-card", async () => {
    const msg = await prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: { variants: { where: { id: variantId } } },
    });
    expect(msg.agentId).toBeNull();
    expect(msg.channel).toBe("content-card");
    expect(msg.variants).toHaveLength(1);
    expect(msg.variants[0].id).toBe(variantId);
  });

  it("GET /api/content-card-library returns grouped library variants", async () => {
    const res = await route.GET(new NextRequest("http://localhost/api/content-card-library"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    const group = json.data.find((g: { category: string; subcategory: string | null }) => g.category === "giving" && g.subcategory === "appeal");
    expect(group).toBeDefined();
    expect(group.variants.some((v: { id: string }) => v.id === variantId)).toBe(true);
  });

  it("POST /api/content-card-library creates a new variant", async () => {
    const res = await route.POST(post({
      name: "Test CC Create",
      title: "Test title",
      body: "Test body text",
      cta: "Learn More",
      deeplink: "https://bible.com/plans",
      category: "bible-plans",
      subcategory: "featured-plans",
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.title).toBe("Test title");
    expect(json.data.cta).toBe("Learn More");
    const created = await prisma.messageVariant.findUniqueOrThrow({ where: { id: json.data.id }, include: { message: true } });
    expect(created.message.agentId).toBeNull();
    expect(created.message.channel).toBe("content-card");
    expect(created.category).toBe("bible-plans");
    expect(created.subcategory).toBe("featured-plans");
    await prisma.message.delete({ where: { id: created.messageId } });
  });

  it("POST /api/content-card-library rejects missing title", async () => {
    const res = await route.POST(post({ name: "No title", body: "body", category: "giving" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("title");
  });
});

describe("content-card payload factory", () => {
  it("buildContentCardApiTriggerPayload includes all trigger_properties", async () => {
    const { PayloadFactory } = await import("@/lib/braze/payload-factory");
    const factory = new PayloadFactory();
    const payload = factory.buildContentCardApiTriggerPayload(
      { title: "T", message: "M", cta: "CTA", link: "https://bible.com" },
      { externalUserIds: ["u1", "u2"] },
      "5b30db0f-c3bb-4fc3-8dd1-15ea6c5b402c",
    );
    expect(payload.campaign_id).toBe("5b30db0f-c3bb-4fc3-8dd1-15ea6c5b402c");
    const tp = payload.trigger_properties as Record<string, string>;
    expect(tp.title).toBe("T");
    expect(tp.message).toBe("M");
    expect(tp.cta).toBe("CTA");
    // Outbound web links carry Nexus UTM attribution (12e2c2b).
    expect(tp.link).toBe("https://bible.com/?utm_campaign=nexus&utm_source=content-card");
    // recipients array
    const recipients = payload.recipients as { external_user_id: string }[];
    expect(recipients.map((r) => r.external_user_id)).toEqual(["u1", "u2"]);
  });

  it("omits null cta and link from trigger_properties", async () => {
    const { PayloadFactory } = await import("@/lib/braze/payload-factory");
    const factory = new PayloadFactory();
    const payload = factory.buildContentCardApiTriggerPayload(
      { title: "T", message: "M", cta: null, link: null },
      { externalUserIds: ["u1"] },
      "campaign-id",
    );
    const tp = payload.trigger_properties as Record<string, string>;
    expect(tp.title).toBe("T");
    expect(tp.message).toBe("M");
    expect("cta" in tp).toBe(false);
    expect("link" in tp).toBe(false);
  });
});
