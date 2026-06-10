// Regression (spec 2026-06-09 flag-targeting-attribution): flag-flip conversions
// were only credited when the user had an ACTIVE assignment (releasedAt: null) —
// a user released (segment_exit, hold cap, manual) whose flag flipped LATER was
// silently dropped. New rule: a flip credits the most recent unconverted decision
// within 30 days of sentAt whose agent has a goal for that flag (most recent
// send wins), regardless of release status. The tail path requires an observed
// false/absent → true transition vs pre-upsert stored attributes.
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
const DAY = 24 * 60 * 60 * 1000;
const FLAG = "votd_interaction_has_ever_flag";

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

// Agent with a first_interaction goal on FLAG, one variant, one decision sent
// `sentDaysAgo` days ago, and a RELEASED assignment.
async function setupReleasedAgent(userId: string, sentDaysAgo: number) {
  const agent = await createAgent();
  await createGoal(agent.id, {
    eventName: FLAG,
    tier: "very_good",
    valueWeight: 5,
    weightMode: "fixed",
    weightDefault: 5,
    conversionType: "first_interaction",
  });
  const msg = await createMessage(agent.id);
  const variant = await createVariant(msg.id);
  const decision = await createUserDecision({
    agentId: agent.id,
    userId,
    messageVariantId: variant.id,
    sentAt: new Date(Date.now() - sentDaysAgo * DAY),
  });
  await createUserAgentAssignment({
    externalUserId: userId,
    agentId: agent.id,
    enrollmentFlags: { [FLAG]: false },
    releasedAt: new Date(Date.now() - 1 * DAY),
    releaseReason: "hold_cap_days",
  });
  return { agent, decision };
}

describe("tail attribution: flips after release still credit within 30 days", () => {
  it("released user, flip 10 days after send → credited; release reason untouched", async () => {
    await createUser("usr_tail_hit");
    const { agent, decision } = await setupReleasedAgent("usr_tail_hit", 10);

    const res = await syncUser("usr_tail_hit", { [FLAG]: true });
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionAt).not.toBeNull();
    expect(updated!.conversionEvent).toBe(FLAG);
    expect(updated!.reward as number).toBeGreaterThan(0);

    // Already-released assignment is untouched (release-on-conversion no-ops).
    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_tail_hit" },
    });
    expect(assignment!.releaseReason).toBe("hold_cap_days");

    // Reporting: same count the dashboards run (conversionAt, no release filter).
    const counted = await prisma.userDecision.count({
      where: { agentId: agent.id, conversionAt: { not: null } },
    });
    expect(counted).toBe(1);
  });

  it("flip 35 days after the send → NOT credited", async () => {
    await createUser("usr_tail_late");
    const { decision } = await setupReleasedAgent("usr_tail_late", 35);

    const res = await syncUser("usr_tail_late", { [FLAG]: true });
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionAt).toBeNull();
  });

  it("flip with no prior send → no credit, sync still succeeds", async () => {
    await createUser("usr_tail_nosend");
    const agent = await createAgent();
    await createGoal(agent.id, {
      eventName: FLAG,
      tier: "very_good",
      valueWeight: 5,
      weightMode: "fixed",
      weightDefault: 5,
      conversionType: "first_interaction",
    });
    await createUserAgentAssignment({
      externalUserId: "usr_tail_nosend",
      agentId: agent.id,
      enrollmentFlags: { [FLAG]: false },
      releasedAt: new Date(Date.now() - 1 * DAY),
      releaseReason: "manual",
    });

    const res = await syncUser("usr_tail_nosend", { [FLAG]: true });
    expect(res.status).toBe(200);
    const count = await prisma.userDecision.count({ where: { conversionAt: { not: null } } });
    expect(count).toBe(0);
  });

  it("most recent send wins when two agents both track the flag", async () => {
    await createUser("usr_tail_two");
    // Agent A sent 10 days ago; released. (Assignment row is globally unique per
    // user, so only ONE assignment exists — history lives in decisions.)
    const { decision: decisionA } = await setupReleasedAgent("usr_tail_two", 10);
    // Agent B sent 2 days ago (decision only — A's released row owns the slot).
    const agentB = await createAgent({ name: "Tail Agent B" });
    await createGoal(agentB.id, {
      eventName: FLAG,
      tier: "very_good",
      valueWeight: 5,
      weightMode: "fixed",
      weightDefault: 5,
      conversionType: "any_interaction",
    });
    const msgB = await createMessage(agentB.id);
    const variantB = await createVariant(msgB.id);
    const decisionB = await createUserDecision({
      agentId: agentB.id,
      userId: "usr_tail_two",
      messageVariantId: variantB.id,
      sentAt: new Date(Date.now() - 2 * DAY),
    });

    const res = await syncUser("usr_tail_two", { [FLAG]: true });
    expect(res.status).toBe(200);

    const b = await prisma.userDecision.findUnique({ where: { id: decisionB.id } });
    const a = await prisma.userDecision.findUnique({ where: { id: decisionA.id } });
    expect(b!.conversionAt).not.toBeNull(); // most recent send wins
    expect(a!.conversionAt).toBeNull();
  });

  it("tail credit to agent A never releases agent B's ACTIVE assignment", async () => {
    await createUser("usr_tail_safe");
    // Agent A: goal + decision 5 days ago, but NO assignment row (overwritten).
    const agentA = await createAgent({ name: "Tail Agent A" });
    await createGoal(agentA.id, {
      eventName: FLAG,
      tier: "very_good",
      valueWeight: 5,
      weightMode: "fixed",
      weightDefault: 5,
      conversionType: "first_interaction",
    });
    const msgA = await createMessage(agentA.id);
    const variantA = await createVariant(msgA.id);
    const decisionA = await createUserDecision({
      agentId: agentA.id,
      userId: "usr_tail_safe",
      messageVariantId: variantA.id,
      sentAt: new Date(Date.now() - 5 * DAY),
    });
    // Agent B: currently owns the user, no flag goals.
    const agentB = await createAgent({ name: "Owner Agent B" });
    await createUserAgentAssignment({
      externalUserId: "usr_tail_safe",
      agentId: agentB.id,
    });
    await prisma.trackedUser.update({
      where: { externalId: "usr_tail_safe" },
      data: { lockedByAgentId: agentB.id },
    });

    const res = await syncUser("usr_tail_safe", { [FLAG]: true });
    expect(res.status).toBe(200);

    const a = await prisma.userDecision.findUnique({ where: { id: decisionA.id } });
    expect(a!.conversionAt).not.toBeNull(); // A credited via tail

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_tail_safe" },
    });
    expect(assignment!.agentId).toBe(agentB.id);
    expect(assignment!.releasedAt).toBeNull(); // B untouched
    const tu = await prisma.trackedUser.findUnique({ where: { externalId: "usr_tail_safe" } });
    expect(tu!.lockedByAgentId).toBe(agentB.id); // lock untouched
  });

  it("stored flag already true → re-sync of true is no transition, no tail credit", async () => {
    await createUser("usr_tail_alreadytrue", { attributes: { [FLAG]: true } });
    const { decision } = await setupReleasedAgent("usr_tail_alreadytrue", 5);

    const res = await syncUser("usr_tail_alreadytrue", { [FLAG]: true });
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionAt).toBeNull();
  });

  it("ACTIVE assignment path still wins over the tail (no behavior change for owned users)", async () => {
    await createUser("usr_tail_active");
    const agent = await createAgent();
    await createGoal(agent.id, {
      eventName: FLAG,
      tier: "very_good",
      valueWeight: 5,
      weightMode: "fixed",
      weightDefault: 5,
      conversionType: "first_interaction",
    });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    const decision = await createUserDecision({
      agentId: agent.id,
      userId: "usr_tail_active",
      messageVariantId: variant.id,
      sentAt: new Date(Date.now() - 1 * DAY),
    });
    await createUserAgentAssignment({
      externalUserId: "usr_tail_active",
      agentId: agent.id,
      enrollmentFlags: { [FLAG]: false },
    });

    const res = await syncUser("usr_tail_active", { [FLAG]: true });
    expect(res.status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated!.conversionAt).not.toBeNull();
    // Exactly one credit — the tail must not double-fire for the same flag.
    const count = await prisma.userDecision.count({
      where: { userId: "usr_tail_active", conversionAt: { not: null } },
    });
    expect(count).toBe(1);
    // Active-path release-on-conversion still applies.
    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_tail_active" },
    });
    expect(assignment!.releaseReason).toBe("conversion");
  });
});
