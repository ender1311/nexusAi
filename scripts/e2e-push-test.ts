/**
 * E2E push test — sends 3 pushes to a test Braze user and records UserDecision rows.
 *
 * Usage: bun scripts/e2e-push-test.ts [externalUserId]
 * Default test user: 183037114 (DanLuk)
 */
import { prisma } from "../src/lib/db";
import { createBrazeClient } from "../src/lib/braze/client";
import { PayloadFactory } from "../src/lib/braze/payload-factory";

const TEST_USER_ID = process.argv[2] ?? "183037114";
const SENDS_COUNT = 9; // send all active variants

const brazeClient = createBrazeClient();
if (!brazeClient) {
  console.error("❌ Braze not configured — set BRAZE_API_KEY and BRAZE_REST_ENDPOINT in .env.local");
  process.exit(1);
}

const factory = new PayloadFactory();

// Load the active push agent
const agent = await prisma.agent.findFirst({
  where: { messages: { some: { channel: "push" } } },
  include: {
    messages: {
      where: { channel: "push" },
      include: { variants: { where: { status: "active" } } },
    },
  },
});

if (!agent) {
  console.error("❌ No agent with push messages found in DB");
  process.exit(1);
}

// Collect up to SENDS_COUNT variants (one per message, different each time)
type VariantInfo = {
  agentId: string;
  variantId: string;
  variantName: string;
  brazeCampaignId: string | null;
  brazeVariantId: string | null;
  body: string;
  title: string | null;
  deeplink: string | null;
};

const variants: VariantInfo[] = agent.messages
  .flatMap((m) =>
    m.variants.map((v) => ({
      agentId:        agent.id,
      variantId:      v.id,
      variantName:    v.name,
      brazeCampaignId: m.brazeCampaignId,
      brazeVariantId: v.brazeVariantId,
      body:           v.body,
      title:          v.title ?? null,
      deeplink:       v.deeplink ?? null,
    }))
  )
  .slice(0, SENDS_COUNT);

if (variants.length === 0) {
  console.error("❌ No active push variants found");
  process.exit(1);
}

// Pad to SENDS_COUNT by repeating if fewer variants available
while (variants.length < SENDS_COUNT) {
  variants.push(variants[variants.length % variants.length]);
}

console.log(`\n🚀 Sending ${SENDS_COUNT} pushes to Braze user ${TEST_USER_ID}`);
console.log(`   Agent: ${agent.name} (${agent.id})`);
console.log();

for (let i = 0; i < SENDS_COUNT; i++) {
  const v = variants[i];
  console.log(`[${i + 1}/${SENDS_COUNT}] Variant: "${v.variantName}"`);
  console.log(`        Title: ${v.title ?? "(none)"}`);
  console.log(`        Body:  ${v.body.slice(0, 80)}${v.body.length > 80 ? "…" : ""}`);

  const audience = { externalUserIds: [TEST_USER_ID] };
  const payload = factory.buildPushPayload(
    { title: v.title ?? "", body: v.body, deeplink: v.deeplink ?? undefined },
    audience,
    v.brazeCampaignId ?? undefined,
    v.brazeVariantId ?? undefined,
  );

  const res = await brazeClient.post("/messages/send", payload);
  const resBody = await res.json().catch(() => ({}));

  if (res.ok) {
    console.log(`        ✅ Sent (HTTP ${res.status})`);

    // Record UserDecision in DB
    await prisma.userDecision.create({
      data: {
        agentId:          v.agentId,
        userId:           TEST_USER_ID,
        messageVariantId: v.variantId,
        channel:          "push",
        sentAt:           new Date(),
        scheduledFor:     new Date(),
      },
    });
    console.log(`        ✅ UserDecision recorded`);
  } else {
    console.error(`        ❌ Failed (HTTP ${res.status}):`, JSON.stringify(resBody));
  }

  console.log();
}

await prisma.$disconnect();
console.log("Done.");
