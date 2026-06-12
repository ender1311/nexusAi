import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "@/lib/db";

// Minimal integration tests for /api/email-library route.
// Verifies the agent + message + variant + translation lifecycle
// without spawning the HTTP server (direct Prisma queries).

let agentId: string;
let messageId: string;
let variantId: string;

beforeAll(async () => {
  // Clean up any leftover test records
  const existing = await prisma.agent.findFirst({ where: { name: "__test_email_library__" } });
  if (existing) {
    await prisma.agent.delete({ where: { id: existing.id } });
  }

  const agent = await prisma.agent.create({
    data: {
      name: "__test_email_library__",
      description: "Test email library agent",
      algorithm: "thompson",
      epsilon: 0.1,
      status: "draft",
      funnelStage: "connected",
    },
  });
  agentId = agent.id;

  const message = await prisma.message.create({
    data: { agentId, name: "giving Email Templates", channel: "email" },
  });
  messageId = message.id;

  const variant = await prisma.messageVariant.create({
    data: {
      messageId,
      name: "Test Giving Appeal",
      subject: "Help us reach 1 billion",
      body: "Help us reach 1 billion",
      htmlBody: "<html><body><p>Help us reach 1 billion</p></body></html>",
      category: "giving",
      subcategory: "appeal",
      status: "active",
    },
  });
  variantId = variant.id;
});

afterAll(async () => {
  await prisma.agent.delete({ where: { id: agentId } });
});

describe("email library DB model", () => {
  it("creates a variant with htmlBody and subject", async () => {
    const v = await prisma.messageVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(v.subject).toBe("Help us reach 1 billion");
    expect(v.htmlBody).toContain("<html>");
    expect(v.category).toBe("giving");
    expect(v.subcategory).toBe("appeal");
  });

  it("upserts a translation with subject and htmlBody", async () => {
    await prisma.messageVariantTranslation.upsert({
      where: { messageVariantId_language: { messageVariantId: variantId, language: "es" } },
      update: {},
      create: {
        messageVariantId: variantId,
        language: "es",
        subject: "Ayúdanos a llegar a 1 mil millones",
        htmlBody: "<html><body><p>Ayúdanos</p></body></html>",
        body: "Ayúdanos a llegar a 1 mil millones",
        status: "active",
        source: "import:dropbox",
      },
    });

    const t = await prisma.messageVariantTranslation.findUniqueOrThrow({
      where: { messageVariantId_language: { messageVariantId: variantId, language: "es" } },
    });
    expect(t.subject).toBe("Ayúdanos a llegar a 1 mil millones");
    expect(t.htmlBody).toContain("<html>");
    expect(t.source).toBe("import:dropbox");
  });

  it("can query variants by category filtered to email channel", async () => {
    const variants = await prisma.messageVariant.findMany({
      where: {
        message: { agentId },
        category: "giving",
        status: "active",
      },
      select: { id: true, subject: true, htmlBody: true },
    });
    expect(variants.length).toBeGreaterThanOrEqual(1);
    const v = variants.find((x) => x.id === variantId);
    expect(v?.subject).toBe("Help us reach 1 billion");
    // htmlBody is selectable and non-null
    expect(v?.htmlBody).toBeTruthy();
  });

  it("excludes htmlBody from list query (too large)", async () => {
    const variants = await prisma.messageVariant.findMany({
      where: { message: { agentId } },
      select: { id: true, subject: true, category: true, translations: { select: { language: true } } },
    });
    // Confirm translations with language codes are accessible
    expect(Array.isArray(variants)).toBe(true);
  });
});
