// Regression: demo sends of dynamic-handle giving variants must substitute
// {{ask}}/{{bibles}} (a past bug shipped raw tokens → Braze rendered them blank),
// and any unresolved {{token}} must be blocked instead of shipped.
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createMessage, createSchedulingRule, createUser, createVariant } from "../helpers/builders";

const mockAuth = { user: { id: "u1", email: "dan.luk@youversion.com", firstName: null, lastName: null }, roles: ["admin"] };
mock.module("@workos-inc/authkit-nextjs", () => ({ withAuth: async () => mockAuth, signOut: async () => {} }));
const { POST } = await import("@/app/api/demo/send/route");

beforeEach(async () => { await truncateAll(); });
afterEach(async () => {});

describe("POST /api/demo/send — giving dynamic-handle", () => {
  test("substitutes {{ask}}/{{bibles}} (passes the unresolved-token guard, reaches Braze gate)", async () => {
    const agent = await createAgent({ name: "Lydia" });
    const msg = await createMessage(agent.id);
    await createSchedulingRule(agent.id);
    const variant = await createVariant(msg.id, {
      name: "Dynamic Handle — Sower Ask $25",
      title: "Become a Sower",
      body: "{{ask}} a month puts the Bible App in {{bibles}} more hands.",
      subcategory: "dynamic-handle",
      actionFeatures: { givingHandleStrategy: "blend", givingFrequency: "monthly", givingHandleDefaultUsd: 25 },
    });
    await createUser("usr_give", {});

    const res = await POST(buildRequest("POST", {
      agentId: agent.id, userIds: ["usr_give"], variantOverrideId: variant.id,
      bypassFrequencyCap: true, bypassQuietHours: true,
    }) as NextRequest);
    const { data } = (await res.json()) as { data: Array<{ status: string; reason?: string }> };
    // Braze env absent in tests → reaching "Braze not configured" means substitution
    // succeeded and the unresolved-token guard passed.
    expect(data[0].status).toBe("failed");
    expect(data[0].reason).toBe("Braze not configured");
  });

  test("blocks a variant whose {{ask}} can't resolve (not dynamic-handle) instead of shipping blanks", async () => {
    const agent = await createAgent({ name: "Misconfig" });
    const msg = await createMessage(agent.id);
    await createSchedulingRule(agent.id);
    const variant = await createVariant(msg.id, {
      name: "Broken token",
      title: "Give",
      body: "{{ask}} a month",   // token but NOT a dynamic-handle variant → never substituted
    });
    await createUser("usr_give", {});

    const res = await POST(buildRequest("POST", {
      agentId: agent.id, userIds: ["usr_give"], variantOverrideId: variant.id,
      bypassFrequencyCap: true, bypassQuietHours: true,
    }) as NextRequest);
    const { data } = (await res.json()) as { data: Array<{ status: string; reason?: string }> };
    expect(data[0].status).toBe("failed");
    expect(data[0].reason).toBe("unresolved template tokens — not sent");
  });
});
