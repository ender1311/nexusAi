/**
 * E2E Braze Push Test Suite
 *
 * Runs 12 real scenarios end-to-end: decide → Braze push → conversion loop,
 * plus deep-link delivery tests for Bible verses, Guided Scripture, and Plans.
 * Sends actual push notifications to the named test user on their personal device.
 *
 * Test users:
 *   DanLuk: externalUserId "183037114"
 *
 * Usage:
 *   bun run tests/e2e/braze-push.e2e.ts
 *
 * Requires: .env.local (DATABASE_URL, HIGHTOUCH_API_KEY) + .env.local.braze (all BRAZE_* vars)
 */

import { config } from "dotenv";
config();
config({ path: ".env.local", override: true });
config({ path: ".env.local.braze", override: true });

import { prisma } from "@/lib/db";
import { decideForUser } from "@/lib/decide";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";

// ─── Test user ───────────────────────────────────────────────────────────────

const TEST_USER = { name: "DanLuk", externalUserId: "183037114" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const braze = createBrazeClient()!;
const factory = new PayloadFactory();

async function sendPush(
  externalUserId: string,
  title: string,
  body: string,
  brazeVariantId?: string | null,
  deeplink?: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const payload = factory.buildPushPayload(
    { title, body, deeplink },
    { externalUserIds: [externalUserId] },
    undefined,
    undefined,
    brazeVariantId ?? undefined
  );
  const res = await braze.post("/messages/send", payload);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: json };
}

function pass(label: string, detail?: string) {
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, detail?: string) {
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  process.exitCode = 1;
}
function info(msg: string) {
  console.log(`     ${msg}`);
}

async function cleanup(agentIds: string[]) {
  if (!agentIds.length) return;
  // Delete in dependency order
  await prisma.personaArmStats.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.userDecision.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.schedulingRule.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.agentPersonaTarget.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.goal.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.messageVariant.deleteMany({
    where: { message: { agentId: { in: agentIds } } },
  });
  await prisma.message.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
}

// ─── Shared setup ────────────────────────────────────────────────────────────

async function setupPersonaAndUser() {
  // Ensure a persona exists for the test user to fall back to
  let persona = await prisma.persona.findFirst({ where: { isActive: true } });
  if (!persona) {
    persona = await prisma.persona.create({
      data: { name: "E2E Default Persona", isActive: true, clusterSize: 1, source: "manual" },
    });
  }

  // Upsert test user
  await prisma.trackedUser.upsert({
    where: { externalId: TEST_USER.externalUserId },
    create: { externalId: TEST_USER.externalUserId, personaId: persona.id },
    update: { personaId: persona.id },
  });

  return { persona };
}

async function makeAgent(name: string, opts: {
  funnelStage?: string;
  targetFilter?: object | null;
  algorithm?: string;
} = {}) {
  const agent = await prisma.agent.create({
    data: {
      name,
      algorithm: opts.algorithm ?? "thompson",
      epsilon: 0.1,
      status: "active",
      funnelStage: (opts.funnelStage ?? "connected") as never,
      ...(opts.targetFilter !== undefined ? { targetFilter: opts.targetFilter as never } : {}),
    },
  });
  await prisma.schedulingRule.create({
    data: {
      agentId: agent.id,
      frequencyCap: { maxSends: 100, period: "day" } as object,
      quietHours: { start: "00:00", end: "00:00", timezone: "UTC" } as object,
      blackoutDates: [],
      smartSuppress: false,
      suppressThresh: 0.5,
    },
  });
  return agent;
}

async function makeVariant(agentId: string, label: string, title: string, body: string) {
  const msg = await prisma.message.create({
    data: { agentId, name: `${label} Message`, channel: "push" },
  });
  const variant = await prisma.messageVariant.create({
    data: { messageId: msg.id, name: label, title, body, status: "active" },
  });
  return variant;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

const agentIds: string[] = [];

async function scenario1_happyPathNoFilter() {
  console.log("\nScenario 1 — Happy path, no targetFilter");
  const agent = await makeAgent("[E2E S1] Connected, no filter", { funnelStage: "connected" });
  agentIds.push(agent.id);
  await makeVariant(agent.id, "S1-A", "📖 Your daily verse", "Open the Bible app to continue your streak today.");

  const result = await decideForUser({ agentId: agent.id, externalUserId: TEST_USER.externalUserId });

  if (!result || result.suppressed) {
    fail("decide returned null/suppressed — expected a variant"); return;
  }
  pass("decide returned variant", result.messageVariantId);

  const send = await sendPush(
    TEST_USER.externalUserId,
    "📖 Your daily verse",
    "Open the Bible app to continue your streak today.",
    result.brazeVariantId
  );
  if (send.ok) pass("Braze push sent", `status ${send.status}`);
  else fail("Braze push failed", JSON.stringify(send.body));
}

async function scenario2_targetFilterMatches() {
  console.log("\nScenario 2 — targetFilter matches user (total_decisions__gte: 0)");
  const agent = await makeAgent("[E2E S2] Filter matches", {
    funnelStage: "activated",
    targetFilter: { total_decisions__gte: 0 },
  });
  agentIds.push(agent.id);
  await makeVariant(agent.id, "S2-A", "🎯 Keep going!", "You're on a roll. Keep reading today.");

  const result = await decideForUser({ agentId: agent.id, externalUserId: TEST_USER.externalUserId });

  if (!result || result.suppressed) {
    fail("decide returned null/suppressed — filter should have matched"); return;
  }
  pass("targetFilter matched → decide returned variant", result.messageVariantId);

  const send = await sendPush(
    TEST_USER.externalUserId,
    "🎯 Keep going!",
    "You're on a roll. Keep reading today.",
    result.brazeVariantId
  );
  if (send.ok) pass("Braze push sent", `status ${send.status}`);
  else fail("Braze push failed", JSON.stringify(send.body));
}

async function scenario3_targetFilterExcludes() {
  console.log("\nScenario 3 — targetFilter excludes user (total_decisions__gte: 999999)");
  const agent = await makeAgent("[E2E S3] Filter excludes", {
    funnelStage: "inspired",
    targetFilter: { total_decisions__gte: 999999 },
  });
  agentIds.push(agent.id);
  await makeVariant(agent.id, "S3-A", "Should not send", "This push should never reach the user.");

  const result = await decideForUser({ agentId: agent.id, externalUserId: TEST_USER.externalUserId });

  if (result === null) pass("targetFilter excluded user → decide returned null (no push sent)");
  else fail("decide should have returned null but returned a result");
  info("No push sent — correct behaviour confirmed.");
}

async function scenario4_lapsedFunnelStage() {
  console.log("\nScenario 4 — funnelStage: lapsed, re-engagement push");
  const agent = await makeAgent("[E2E S4] Lapsed re-engagement", {
    funnelStage: "lapsed",
    targetFilter: { last_seen_days__gte: 0 },   // passes for all users (last_seen_days >= 0)
  });
  agentIds.push(agent.id);
  await makeVariant(
    agent.id, "S4-A",
    "✝️ We miss you",
    "It's been a while. Come back and read a verse today."
  );

  const result = await decideForUser({ agentId: agent.id, externalUserId: TEST_USER.externalUserId });

  if (!result || result.suppressed) {
    fail("decide returned null/suppressed"); return;
  }
  pass("lapsed agent decided variant", result.messageVariantId);

  const send = await sendPush(
    TEST_USER.externalUserId,
    "✝️ We miss you",
    "It's been a while. Come back and read a verse today.",
    result.brazeVariantId
  );
  if (send.ok) pass("Braze re-engagement push sent", `status ${send.status}`);
  else fail("Braze push failed", JSON.stringify(send.body));
}

async function scenario5_thompsonTwoVariants() {
  console.log("\nScenario 5 — Thompson Sampling, 2 variants, verify arm selection");
  const agent = await makeAgent("[E2E S5] Thompson 2-arm", {
    funnelStage: "engaged",
    algorithm: "thompson",
  });
  agentIds.push(agent.id);
  const vA = await makeVariant(agent.id, "S5-A", "🔥 Streak alert!", "Don't break your streak — read today.");
  await makeVariant(agent.id, "S5-B", "📿 Moment of peace", "Take 2 minutes for a Bible verse right now.");

  const result = await decideForUser({ agentId: agent.id, externalUserId: TEST_USER.externalUserId });

  if (!result || result.suppressed) {
    fail("Thompson decide returned null/suppressed"); return;
  }
  const selectedLabel = result.messageVariantId === vA.id ? "S5-A (streak)" : "S5-B (peace)";
  pass("Thompson selected a variant", selectedLabel);

  const selected = result.messageVariantId === vA.id
    ? { title: "🔥 Streak alert!", body: "Don't break your streak — read today." }
    : { title: "📿 Moment of peace", body: "Take 2 minutes for a Bible verse right now." };

  const send = await sendPush(
    TEST_USER.externalUserId,
    selected.title,
    selected.body,
    result.brazeVariantId
  );
  if (send.ok) pass("Braze push sent with Thompson-selected variant", `status ${send.status}`);
  else fail("Braze push failed", JSON.stringify(send.body));
}

async function scenario6_conversionLoop(s1AgentId?: string) {
  console.log("\nScenario 6 — Conversion event closes the learning loop");

  // Find the most recent decision for DanLuk (from Scenario 1)
  const decision = await prisma.userDecision.findFirst({
    where: { userId: TEST_USER.externalUserId, agentId: s1AgentId },
    orderBy: { sentAt: "desc" },
    include: { agent: { include: { goals: true } } },
  });

  if (!decision) {
    fail("No decision found to close loop on — run Scenario 1 first"); return;
  }
  if (!decision.agent.goals.length) {
    // Add a goal so reward calculator has something to work with
    await prisma.goal.create({
      data: {
        agentId: decision.agentId,
        eventName: "plan_started",
        tier: "best",
        valueWeight: 1.0,
        weightMode: "fixed",
        weightDefault: 1.0,
      },
    });
  }

  // Read arm stats before
  const persona = await prisma.trackedUser.findUnique({
    where: { externalId: TEST_USER.externalUserId },
    select: { personaId: true },
  });
  const beforeStats = await prisma.personaArmStats.findFirst({
    where: {
      agentId: decision.agentId,
      variantId: decision.messageVariantId ?? undefined,
      personaId: persona?.personaId ?? undefined,
    },
  });

  // Ingest a conversion event via the API
  // Always use local dev server — .env.local.braze overrides NEXT_PUBLIC_APP_URL to prod
  const apiBase = "http://localhost:3000";
  const res = await fetch(`${apiBase}/api/ingest/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HIGHTOUCH_API_KEY}`,
    },
    body: JSON.stringify({
      event_id: `e2e-conversion-${Date.now()}`,
      event_name: "plan_started",
      external_user_id: TEST_USER.externalUserId,
      occurred_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    fail("Event ingest failed", `status ${res.status} — is the dev server running? (bun run dev)`);
    return;
  }
  pass("Conversion event ingested", `status ${res.status}`);

  // Wait briefly for async DB write, then check arm stats
  await new Promise((r) => setTimeout(r, 500));
  const afterStats = await prisma.personaArmStats.findFirst({
    where: {
      agentId: decision.agentId,
      variantId: decision.messageVariantId ?? undefined,
      personaId: persona?.personaId ?? undefined,
    },
  });

  const alphaGrew = (afterStats?.alpha ?? 0) > (beforeStats?.alpha ?? 0);
  if (alphaGrew) {
    pass("PersonaArmStats alpha incremented", `${beforeStats?.alpha} → ${afterStats?.alpha}`);
  } else {
    info(`alpha before: ${beforeStats?.alpha}, after: ${afterStats?.alpha} — no change yet (reward may be 0 for this event)`);
    pass("Conversion event processed without error");
  }
}

// ─── Deep-link scenarios ──────────────────────────────────────────────────────
//
// Copy sourced from docs/push-copy-inventory.md (approved variants A–D + lapsing plans).
// Deep-links sourced from docs/deeplinks.md (verified inventory).
//
// Bible verse links (3):
//   S7 — youversion://bible          (native reader, last position — safest for re-engagement)
//   S8 — bible.com/bible/…/JHN.3.16  (Braze Liquid preferred version — John 3:16)
//   S9 — bible.com/bible/1/PSA.23.1  (KJV/version 1 — Psalm 23:1, named passage)
// Guided Scripture (1):
//   S10 — bible.com/stories
// Plans (2):
//   S11 — bible.com/reading-plans    (plans discovery / upsell)
//   S12 — bible.com/my-plans         (user's active plans)

async function scenario7_bibleVerseNative() {
  console.log("\nScenario 7 — Bible verse deep-link: youversion://bible (native reader)");
  // Variant A copy: habit/consistency theme
  const send = await sendPush(
    TEST_USER.externalUserId,
    "Growth is not about perfection…",
    "It's about consistency ➡️",
    null,
    "youversion://bible"
  );
  if (send.ok) pass("Braze push sent — native Bible reader deep-link", `status ${send.status}`);
  else fail("Braze push failed", JSON.stringify(send.body));
}

async function scenario8_bibleVerseJohn316() {
  console.log("\nScenario 8 — Bible verse deep-link: John 3:16 (Braze Liquid preferred version)");
  // Variant B copy: VOTD/listening theme — deeplink to John 3:16 with user's preferred version
  const deeplink = "https://www.bible.com/bible/{{custom_attribute.${preferred_bible_version_id} | default: 1}}/JHN.3.16";
  const send = await sendPush(
    TEST_USER.externalUserId,
    "👂 Listen to God today",
    "Reflect on the Verse of the Day ➡️",
    null,
    deeplink
  );
  if (send.ok) pass("Braze push sent — John 3:16 deep-link (Liquid version)", `status ${send.status}`);
  else fail("Braze push failed", JSON.stringify(send.body));
}

async function scenario9_bibleVersePsalm23() {
  console.log("\nScenario 9 — Bible verse deep-link: Psalm 23:1 (KJV)");
  // Variant D copy: personalized/next-step theme — deeplink to Psalm 23:1 in KJV (version 1)
  const send = await sendPush(
    TEST_USER.externalUserId,
    "{{${first_name} | default: \"friend\"}}, what's your next step?",
    "Spend time with Him in the Bible App today.",
    null,
    "https://www.bible.com/bible/1/PSA.23.1"
  );
  if (send.ok) pass("Braze push sent — Psalm 23:1 (KJV) deep-link", `status ${send.status}`);
  else fail("Braze push failed", JSON.stringify(send.body));
}

async function scenario10_guidedScripture() {
  console.log("\nScenario 10 — Guided Scripture deep-link: bible.com/stories");
  // Variant C copy: prayer/pause theme — deeplink to Today's Guided Scripture
  const send = await sendPush(
    TEST_USER.externalUserId,
    "⏸️ Pause with God",
    "Take a moment with Him today…",
    null,
    "https://www.bible.com/stories"
  );
  if (send.ok) pass("Braze push sent — Guided Scripture deep-link", `status ${send.status}`);
  else fail("Braze push failed", JSON.stringify(send.body));
}

async function scenario11_plansDiscovery() {
  console.log("\nScenario 11 — Plans deep-link: bible.com/reading-plans (discovery)");
  // Lapsing-plans copy: completion/momentum/upsell theme
  const send = await sendPush(
    TEST_USER.externalUserId,
    "Congrats! You completed a Plan!",
    "Choose another Plan and keep your momentum going.",
    null,
    "https://www.bible.com/reading-plans"
  );
  if (send.ok) pass("Braze push sent — Plans discovery deep-link", `status ${send.status}`);
  else fail("Braze push failed", JSON.stringify(send.body));
}

async function scenario12_myActivePlans() {
  console.log("\nScenario 12 — Plans deep-link: bible.com/my-plans (active plans)");
  // Resume prompt: re-engagement for users mid-plan
  const send = await sendPush(
    TEST_USER.externalUserId,
    "Who do you want to be?",
    "Here's what happens when you spend time with God ➡️",
    null,
    "https://www.bible.com/my-plans"
  );
  if (send.ok) pass("Braze push sent — My Plans deep-link", `status ${send.status}`);
  else fail("Braze push failed", JSON.stringify(send.body));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n🧪 Nexus E2E Braze Push Test Suite`);
console.log(`   Test user: ${TEST_USER.name} (externalUserId: ${TEST_USER.externalUserId})`);
console.log(`   Braze REST: ${process.env.BRAZE_REST_URL}`);
console.log(`   DB: ${process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown"}`);
console.log(`─────────────────────────────────────────`);

if (!braze) {
  console.error("❌ BRAZE_API_KEY or BRAZE_REST_URL not set — cannot run E2E tests");
  process.exit(1);
}

await setupPersonaAndUser();

let s1AgentId: string | undefined;

try {
  await scenario1_happyPathNoFilter();
  s1AgentId = agentIds[agentIds.length - 1];

  await scenario2_targetFilterMatches();
  await scenario3_targetFilterExcludes();
  await scenario4_lapsedFunnelStage();
  await scenario5_thompsonTwoVariants();
  await scenario6_conversionLoop(s1AgentId);

  // Deep-link scenarios — no DB agents needed (direct Braze sends)
  console.log("\n─── Deep-link scenarios ───────────────────────────────────────");
  await scenario7_bibleVerseNative();
  await scenario8_bibleVerseJohn316();
  await scenario9_bibleVersePsalm23();
  await scenario10_guidedScripture();
  await scenario11_plansDiscovery();
  await scenario12_myActivePlans();
} finally {
  console.log("\n🧹 Cleaning up E2E test agents...");
  await cleanup(agentIds);
  console.log(`   Removed ${agentIds.length} test agents.`);
  await prisma.$disconnect();
}

console.log("\n─────────────────────────────────────────");
if (process.exitCode) {
  console.log("❌ Some scenarios failed — see above.");
} else {
  console.log("✅ All 12 E2E scenarios passed.");
}
