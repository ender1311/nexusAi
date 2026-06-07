import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createUser, createPersona, createAgent, createMessage, createVariant, createUserDecision } from "../helpers/builders";

const { GET } = await import("@/app/api/users/[externalId]/route");

function ctx(externalId: string) {
  return { params: Promise.resolve({ externalId }) };
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/users/[externalId] — extended fields", () => {
  it("returns parsed attributes, funnel, timezone, channelStats, and messagingHistory", async () => {
    const persona = await createPersona({ name: "Engaged" });
    await createUser("ext-1", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { email: "a@b.com", name: "Ann", language_tag: "en" },
    });
    await prisma.trackedUser.update({
      where: { externalId: "ext-1" },
      data: { timezone: "America/New_York", preferredSendHour: 9, preferredSendMinute: 30,
              channelStats: { push: { sent: 3, converted: 1 } }, funnelStageUpdatedAt: new Date("2026-06-01T00:00:00Z") },
    });

    const agent = await createAgent({ name: "Agent X" });
    const message = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(message.id, { name: "Var A", title: "Hello" });
    await createUserDecision({
      agentId: agent.id, userId: "ext-1", messageVariantId: variant.id, channel: "push",
      sentAt: new Date("2026-06-05T10:00:00Z"), conversionEvent: "gift_given", conversionAt: new Date("2026-06-05T12:00:00Z"),
    });

    const res = await GET(new Request("http://localhost/"), ctx("ext-1"));
    const body = await res.json();
    expect(res.status).toBe(200);

    expect(body.data.user).toMatchObject({
      externalId: "ext-1", personaName: "Engaged", funnelStage: "wau",
      timezone: "America/New_York", preferredSendHour: 9, preferredSendMinute: 30,
    });
    expect(body.data.attributes).toMatchObject({ email: "a@b.com", name: "Ann", language_tag: "en" });
    expect(body.data.channelStats).toMatchObject({ push: { sent: 3, converted: 1 } });

    const types = body.data.messagingHistory.map((e: { type: string }) => e.type);
    expect(types).toContain("sent");
    expect(types).toContain("conversion");
    const conv = body.data.messagingHistory.find((e: { type: string }) => e.type === "conversion");
    expect(conv.conversionEvent).toBe("gift_given");
    expect(conv.agentName).toBe("Agent X");
  });

  it("returns 404 for an unknown user", async () => {
    const res = await GET(new Request("http://localhost/"), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("excludes decisions older than 30 days from messagingHistory", async () => {
    await createUser("ext-old", {});
    const agent = await createAgent({ name: "A" });
    const message = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(message.id, {});
    await createUserDecision({ agentId: agent.id, userId: "ext-old", messageVariantId: variant.id, sentAt: new Date(Date.now() - 40 * 86_400_000) });

    const res = await GET(new Request("http://localhost/"), ctx("ext-old"));
    const body = await res.json();
    expect(body.data.messagingHistory).toEqual([]);
  });
});
