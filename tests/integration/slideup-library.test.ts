import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

// Call the route handlers directly (the WorkOS session is stubbed as an admin in
// tests/setup/bun.ts) instead of fetching a dev server on localhost:3000.
const route = await import("@/app/api/slideup-library/route");
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/slideup-library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Integration tests for /api/slideup-library route.
// Verifies the library message + variant lifecycle against the real handlers.

let messageId: string;
let variantId: string;

beforeAll(async () => {
  const existing = await prisma.message.findFirst({
    where: { agentId: null, channel: "in-app", name: "__test_slideup_library__" },
  });
  if (existing) {
    await prisma.message.delete({ where: { id: existing.id } });
  }

  const message = await prisma.message.create({
    data: { agentId: null, name: "__test_slideup_library__", channel: "in-app" },
  });
  messageId = message.id;

  const variant = await prisma.messageVariant.create({
    data: {
      messageId,
      name: "Share Your Faith Slideup",
      title: null, // slideup-only
      body: "Not sure how to share your faith? These Bible Plans can help.",
      deeplink: "https://www.bible.com/reading-plans-collection/9371",
      iconImageUrl: null,
      category: "community",
      subcategory: "sharing",
      status: "active",
    },
  });
  variantId = variant.id;
});

afterAll(async () => {
  await prisma.message.delete({ where: { id: messageId } });
});

describe("slideup library DB model", () => {
  it("creates a library variant with slideup fields", async () => {
    const v = await prisma.messageVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(v.title).toBeNull();
    expect(v.body).toBe("Not sure how to share your faith? These Bible Plans can help.");
    expect(v.deeplink).toBe("https://www.bible.com/reading-plans-collection/9371");
    expect(v.category).toBe("community");
    expect(v.subcategory).toBe("sharing");
    expect(v.status).toBe("active");
  });

  it("library variant is agentId null and channel in-app", async () => {
    const msg = await prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: { variants: { where: { id: variantId } } },
    });
    expect(msg.agentId).toBeNull();
    expect(msg.channel).toBe("in-app");
    expect(msg.variants).toHaveLength(1);
    expect(msg.variants[0].id).toBe(variantId);
  });

  it("GET /api/slideup-library returns grouped library variants", async () => {
    const res = await route.GET(new NextRequest("http://localhost/api/slideup-library"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    const group = json.data.find((g: { category: string; subcategory: string | null }) => g.category === "community" && g.subcategory === "sharing");
    expect(group).toBeDefined();
    expect(group.variants.some((v: { id: string }) => v.id === variantId)).toBe(true);
  });

  it("POST /api/slideup-library creates a new slideup variant", async () => {
    const res = await route.POST(post({
      name: "Test Slideup Create",
      body: "Test slideup message body",
      deeplink: "https://bible.com/plans",
      category: "bible-plans",
      subcategory: "featured-plans",
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.body).toBe("Test slideup message body");
    expect(json.data.title).toBeNull();
    const created = await prisma.messageVariant.findUniqueOrThrow({ where: { id: json.data.id }, include: { message: true } });
    expect(created.message.agentId).toBeNull();
    expect(created.message.channel).toBe("in-app");
    expect(created.category).toBe("bible-plans");
    await prisma.message.delete({ where: { id: created.messageId } });
  });

  it("POST /api/slideup-library rejects missing body", async () => {
    const res = await route.POST(post({ name: "No body", category: "giving" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("body");
  });

  it("POST /api/slideup-library rejects invalid category", async () => {
    const res = await route.POST(post({ name: "Bad cat", body: "hello", category: "not-a-category" }));
    expect(res.status).toBe(400);
  });
});

describe("slideup canvas payload factory", () => {
  it("buildCanvasApiTriggerPayload sets slideupOnly=true when title is null", async () => {
    const { PayloadFactory } = await import("@/lib/braze/payload-factory");
    const factory = new PayloadFactory();
    const payload = factory.buildCanvasApiTriggerPayload(
      { title: null, message: "Test msg", link: "https://bible.com", imageUrl: "https://img/a.jpg" },
      { externalUserIds: ["u1", "u2"] },
      "f1e8400b-4261-489d-b830-f073602adb9d",
    );
    expect(payload.canvas_id).toBe("f1e8400b-4261-489d-b830-f073602adb9d");
    const ep = payload.canvas_entry_properties as Record<string, unknown>;
    expect(ep.slideupOnly).toBe(true);
    expect("title" in ep).toBe(false);
    expect(ep.message).toBe("Test msg");
    // Outbound web links carry Nexus UTM attribution (12e2c2b).
    expect(ep.link).toBe("https://bible.com/?utm_campaign=nexus&utm_source=in-app");
    expect(ep.imageUrl).toBe("https://img/a.jpg");
    const recipients = payload.recipients as { external_user_id: string }[];
    expect(recipients.map((r) => r.external_user_id)).toEqual(["u1", "u2"]);
  });

  it("buildCanvasApiTriggerPayload sets slideupOnly=false when title is present", async () => {
    const { PayloadFactory } = await import("@/lib/braze/payload-factory");
    const factory = new PayloadFactory();
    const payload = factory.buildCanvasApiTriggerPayload(
      { title: "Push title", message: "Push body", link: null, imageUrl: null },
      { externalUserIds: ["u1"] },
      "canvas-id",
    );
    const ep = payload.canvas_entry_properties as Record<string, unknown>;
    expect(ep.slideupOnly).toBe(false);
    expect(ep.title).toBe("Push title");
    expect("link" in ep).toBe(false);
    expect("imageUrl" in ep).toBe(false);
  });

  it("omits null link and imageUrl from canvas_entry_properties", async () => {
    const { PayloadFactory } = await import("@/lib/braze/payload-factory");
    const factory = new PayloadFactory();
    const payload = factory.buildCanvasApiTriggerPayload(
      { title: null, message: "M", link: null, imageUrl: null },
      { externalUserIds: ["u1"] },
      "canvas-id",
    );
    const ep = payload.canvas_entry_properties as Record<string, unknown>;
    expect("link" in ep).toBe(false);
    expect("imageUrl" in ep).toBe(false);
  });
});
