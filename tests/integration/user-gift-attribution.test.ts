// Integration: GET /api/users/[externalId] returns per-user gift attribution.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createDecision, createUser } from "../helpers/builders";
import { GET as getUser } from "@/app/api/users/[externalId]/route";
import { NextRequest } from "next/server";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

function call(externalId: string) {
  const req = new NextRequest(`http://localhost:3000/api/users/${externalId}`);
  return getUser(req, { params: Promise.resolve({ externalId }) });
}

describe("GET /api/users/[externalId] gift attribution", () => {
  it("returns gift count, total USD, and most-recent gift detail", async () => {
    await createUser("u_gift_user");
    const agent = await createAgent({ status: "active", name: "Giving Agent" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);
    const sentAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const gift = await createDecision({ agentId: agent.id, userId: "u_gift_user", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "b_gu" });
    const conversionAt = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);
    await prisma.userDecision.update({
      where: { id: gift.id },
      data: { conversionEvent: "gift_given", conversionAt, conversionValue: 120, reward: 0.7 },
    });

    const res = await call("u_gift_user");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.gifts.count).toBe(1);
    expect(body.data.gifts.totalUsd).toBeCloseTo(120, 2);
    expect(body.data.gifts.mostRecent.agentName).toBe("Giving Agent");
    expect(body.data.gifts.mostRecent.timeToGiftHours).toBeCloseTo(24, 0);
  });

  it("returns a null gifts.mostRecent when the user has no attributed gifts", async () => {
    await createUser("u_no_gift");
    const res = await call("u_no_gift");
    const body = await res.json();
    expect(body.data.gifts.count).toBe(0);
    expect(body.data.gifts.totalUsd).toBe(0);
    expect(body.data.gifts.mostRecent).toBeNull();
  });
});
