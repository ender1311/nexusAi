import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createGoal,
  createMessage,
  createVariant,
  createUser,
  createUserDecision,
  createUserAgentAssignment,
} from "../helpers/builders";
import { POST } from "@/app/api/ingest/users/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

function syncUser(externalId: string, attributes: Record<string, unknown>) {
  const req = buildRequest(
    "POST",
    { users: [{ external_user_id: externalId, attributes }] },
    AUTH,
  );
  return POST(req as NextRequest);
}

describe("POST /api/ingest/users — interaction-flag conversions", () => {
  // ── Case 1: Type A credits ────────────────────────────────────────────────
  it("Type A: credits first_interaction when flag flips true and enrollment baseline was false", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, {
      eventName: "plan_interaction_has_ever_flag",
      tier: "very_good",
      valueWeight: 7,
      weightMode: "fixed",
      weightDefault: 7,
      conversionType: "first_interaction",
    });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_flag_a");
    const decision = await createUserDecision({
      agentId: agent.id,
      userId: "usr_flag_a",
      messageVariantId: variant.id,
      sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    });
    await createUserAgentAssignment({
      externalUserId: "usr_flag_a",
      agentId: agent.id,
      enrollmentFlags: { plan_interaction_has_ever_flag: false },
    });

    const res = await syncUser("usr_flag_a", {
      plan_interaction_has_ever_flag: true,
    });
    expect(res.status).toBe(200);

    // Decision must be stamped
    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionAt).not.toBeNull();
    expect(updated!.conversionEvent).toBe("plan_interaction_has_ever_flag");
    // Bandit reward path must be exercised — reward is non-null and positive
    expect(updated!.reward).not.toBeNull();
    expect(updated!.reward as number).toBeGreaterThan(0);

    // Assignment must be released with reason "conversion"
    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_flag_a" },
    });
    expect(assignment!.releasedAt).not.toBeNull();
    expect(assignment!.releaseReason).toBe("conversion");
  });

  // ── Case 2: Type A blocked by baseline ───────────────────────────────────
  it("Type A: blocked when enrollment baseline was already true (not a first interaction)", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, {
      eventName: "plan_interaction_has_ever_flag",
      tier: "very_good",
      valueWeight: 7,
      weightMode: "fixed",
      weightDefault: 7,
      conversionType: "first_interaction",
    });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_flag_b");
    const decision = await createUserDecision({
      agentId: agent.id,
      userId: "usr_flag_b",
      messageVariantId: variant.id,
      sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    // Enrollment flag already true — should NOT be credited as a first_interaction
    await createUserAgentAssignment({
      externalUserId: "usr_flag_b",
      agentId: agent.id,
      enrollmentFlags: { plan_interaction_has_ever_flag: true },
    });

    const res = await syncUser("usr_flag_b", {
      plan_interaction_has_ever_flag: true,
    });
    expect(res.status).toBe(200);

    // Decision must stay unconverted
    const unchanged = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(unchanged!.conversionAt).toBeNull();
    expect(unchanged!.conversionEvent).toBeNull();

    // Assignment must remain active
    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_flag_b" },
    });
    expect(assignment!.releasedAt).toBeNull();
  });

  // ── Case 3: owned but no attributable decision ────────────────────────────
  it("owned user with no unconverted UserDecision: no throw, 200, unmatched_flag_conversions logged", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, {
      eventName: "plan_interaction_has_ever_flag",
      tier: "very_good",
      valueWeight: 7,
      weightMode: "fixed",
      weightDefault: 7,
      conversionType: "first_interaction",
    });
    await createUser("usr_flag_c");
    // No UserDecision created
    await createUserAgentAssignment({
      externalUserId: "usr_flag_c",
      agentId: agent.id,
      enrollmentFlags: { plan_interaction_has_ever_flag: false },
    });

    const res = await syncUser("usr_flag_c", {
      plan_interaction_has_ever_flag: true,
    });
    expect(res.status).toBe(200);

    // Must log unmatched conversion in IngestSyncLog details
    const logs = await prisma.ingestSyncLog.findMany({
      where: { syncKind: "user_sync" },
      orderBy: { createdAt: "desc" },
    });
    expect(logs.length).toBeGreaterThan(0);
    const details = logs[0]!.details as Record<string, unknown>;
    expect(typeof details.unmatched_flag_conversions).toBe("number");
    expect(details.unmatched_flag_conversions as number).toBe(1);
  });

  // ── Case 4: not owned ─────────────────────────────────────────────────────
  it("not-owned user with flag flip: no conversion, no error", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, {
      eventName: "plan_interaction_has_ever_flag",
      tier: "very_good",
      valueWeight: 7,
      weightMode: "fixed",
      weightDefault: 7,
      conversionType: "first_interaction",
    });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_flag_d");
    const decision = await createUserDecision({
      agentId: agent.id,
      userId: "usr_flag_d",
      messageVariantId: variant.id,
      sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    // No UserAgentAssignment — user is NOT owned

    const res = await syncUser("usr_flag_d", {
      plan_interaction_has_ever_flag: true,
    });
    expect(res.status).toBe(200);

    // Decision must remain unconverted
    const unchanged = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(unchanged!.conversionAt).toBeNull();
  });

  // ── Type B: any_interaction credits regardless of baseline ────────────────
  it("Type B: any_interaction credits when flag is true (enrollment baseline irrelevant)", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, {
      eventName: "votd_interaction_has_ever_flag",
      tier: "good",
      valueWeight: 5,
      weightMode: "fixed",
      weightDefault: 5,
      conversionType: "any_interaction",
    });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_flag_e");
    const decision = await createUserDecision({
      agentId: agent.id,
      userId: "usr_flag_e",
      messageVariantId: variant.id,
      sentAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    // Enrollment baseline already true — Type B still credits
    await createUserAgentAssignment({
      externalUserId: "usr_flag_e",
      agentId: agent.id,
      enrollmentFlags: { votd_interaction_has_ever_flag: true },
    });

    const res = await syncUser("usr_flag_e", {
      votd_interaction_has_ever_flag: true,
    });
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionAt).not.toBeNull();
    expect(updated!.conversionEvent).toBe("votd_interaction_has_ever_flag");

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_flag_e" },
    });
    expect(assignment!.releasedAt).not.toBeNull();
    expect(assignment!.releaseReason).toBe("conversion");
  });
});
