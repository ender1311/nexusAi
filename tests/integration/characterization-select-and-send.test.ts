// CHARACTERIZATION (P0 safety net, spec 2026-10-13 §10): end-to-end cron
// runs with seeded randomness and a frozen clock. Freezes WHICH users get
// WHICH variant via WHICH Braze call, for a Thompson push agent and a LinUCB
// push agent. The P2 refactor (Activator extraction, queue) must keep these
// snapshots green. Update with `bun test -u` only for intended, reviewed
// behaviour changes.
//
// Variant selection is pinned by decisive pre-seeded arm state (PersonaArmStats
// for Thompson, LinUCBArm for LinUCB), NOT by the Math.random stream: Prisma 7
// generates cuid() defaults with Math.random, so any added or reordered create
// would otherwise shift every draw.
import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { seedRandom } from "../helpers/seeded-random";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };
const NOW = new Date("2026-05-30T15:00:00Z");
const BRAZE_TEST_URL = "https://rest.test.braze.com";
const ID_RE = /\b(c[a-z0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g;
const ENV_KEYS = ["CRON_SECRET", "BRAZE_API_KEY", "BRAZE_REST_URL", "BRAZE_REST_ENDPOINT", "BRAZE_NEXUS_CAMPAIGN_ID"] as const;
// Decisive Beta priors: Beta(1e6, 1) samples ~1, Beta(1, 1e6) samples ~1e-6.
const WINNING = { alpha: 1e6, beta: 1 };
const LOSING = { alpha: 1, beta: 1e6 };

let brazeRequests: Array<{ url: string; body: unknown }> = [];
let originalFetch: typeof globalThis.fetch;
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>;
let restoreRandom: () => void;

/**
 * Replace known ids with their names (variant "A", message "Test Message"),
 * then any remaining generated id with a stable, first-seen-order placeholder.
 */
function stabilize(value: unknown, knownNames: Map<string, string>): unknown {
  const placeholders = new Map<string, string>();
  const json = JSON.stringify(value).replace(ID_RE, (id) => {
    const known = knownNames.get(id);
    if (known) return known;
    if (!placeholders.has(id)) placeholders.set(id, `<id${placeholders.size + 1}>`);
    return placeholders.get(id)!;
  });
  return JSON.parse(json);
}

function unitVector(dim: number): number[] {
  const v = new Array<number>(FEATURE_DIM).fill(0);
  v[dim] = 1;
  return v;
}

function identityMatrix(): number[] {
  const m = new Array<number>(FEATURE_DIM * FEATURE_DIM).fill(0);
  for (let i = 0; i < FEATURE_DIM; i++) m[i * FEATURE_DIM + i] = 1;
  return m;
}

/** Agent with one push message and variants A/B; returns ids and an id→name map. */
async function createPushAgent(algorithm: "thompson" | "linucb") {
  const agent = await createAgent({ name: "Char Agent", algorithm, funnelStage: "wau" });
  const message = await createMessage(agent.id, { channel: "push", brazeCampaignId: "camp_char" });
  const variantA = await createVariant(message.id, { name: "A", body: "Variant A", brazeVariantId: "bv-A" });
  const variantB = await createVariant(message.id, { name: "B", body: "Variant B", brazeVariantId: "bv-B" });
  const names = new Map<string, string>([
    [agent.id, "Char Agent"],
    [message.id, message.name],
    [variantA.id, "A"],
    [variantB.id, "B"],
  ]);
  return { agent, variantA, variantB, names };
}

async function runCron(): Promise<void> {
  const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
  expect(res.status).toBe(200);
}

async function loadDecisions(agentId: string) {
  return prisma.userDecision.findMany({
    where: { agentId },
    orderBy: { userId: "asc" },
    select: { userId: true, messageVariantId: true, channel: true, brazeSendId: true, sentAt: true, scheduledFor: true, scheduledLocalHour: true },
  });
}

function sendSnapshot(decisions: Awaited<ReturnType<typeof loadDecisions>>) {
  return {
    brazeRequests: brazeRequests
      .map((r) => ({ url: r.url, body: r.body }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    decisions: decisions.map((d) => ({
      user: d.userId,
      variant: d.messageVariantId,
      channel: d.channel,
      brazeSendId: d.brazeSendId ? "<set>" : null,
      sentAt: d.sentAt?.toISOString() ?? null,
      scheduledFor: d.scheduledFor?.toISOString() ?? null,
      scheduledLocalHour: d.scheduledLocalHour,
    })),
  };
}

beforeEach(async () => {
  await truncateAll();
  originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.CRON_SECRET = "test_cron_secret";
  process.env.BRAZE_API_KEY = "test_braze_key";
  // The Braze client prefers BRAZE_REST_ENDPOINT over BRAZE_REST_URL; pin both
  // so a developer's shell can never route this test at a real cluster.
  process.env.BRAZE_REST_URL = BRAZE_TEST_URL;
  process.env.BRAZE_REST_ENDPOINT = BRAZE_TEST_URL;
  process.env.BRAZE_NEXUS_CAMPAIGN_ID = "nexus-campaign";
  brazeRequests = [];
  setSystemTime(NOW);
  restoreRandom = seedRandom(42);
  originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("rest.test.braze.com")) {
      brazeRequests.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return new Response(JSON.stringify({ message: "success" }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, init);
  };
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  restoreRandom();
  setSystemTime();
  await truncateAll();
  for (const k of ENV_KEYS) {
    const original = originalEnv[k];
    if (original === undefined) delete process.env[k];
    else process.env[k] = original;
  }
});

describe("characterization: one select-and-send run", () => {
  it("sends the same variants to the same users via the same Braze calls", async () => {
    // Setup mirrors the passing send case in tests/integration/cron-send.test.ts:85-89
    // (thompson push agent, wau users), widened to two variants, two personas and
    // five users with fixed externalIds u1..u5 and fixed brazeVariantIds "bv-A" / "bv-B".
    // Persona P1 strongly prefers A, P2 strongly prefers B, so the split
    // (u1,u3,u4 → A; u2,u5 → B) holds whatever the Math.random draws are.
    const { agent, variantA, variantB, names } = await createPushAgent("thompson");
    const p1 = await createPersona({ name: "Char Persona A" });
    const p2 = await createPersona({ name: "Char Persona B" });
    await prisma.personaArmStats.createMany({
      data: [
        { personaId: p1.id, agentId: agent.id, variantId: variantA.id, ...WINNING },
        { personaId: p1.id, agentId: agent.id, variantId: variantB.id, ...LOSING },
        { personaId: p2.id, agentId: agent.id, variantId: variantA.id, ...LOSING },
        { personaId: p2.id, agentId: agent.id, variantId: variantB.id, ...WINNING },
      ],
    });
    const personaByUser: Record<string, string> = { u1: p1.id, u2: p2.id, u3: p1.id, u4: p1.id, u5: p2.id };
    for (const [id, personaId] of Object.entries(personaByUser)) {
      await createUser(id, { personaId, funnelStage: "wau" });
    }
    await linkAgentToPersona(agent.id, p1.id);
    await linkAgentToPersona(agent.id, p2.id);
    await createSchedulingRule(agent.id);

    await runCron();

    const decisions = await loadDecisions(agent.id);
    expect(decisions.length).toBeGreaterThan(0);
    expect(stabilize(sendSnapshot(decisions), names)).toMatchSnapshot();
  });

  it("LinUCB: sends the arm whose b vector matches each user's context, and a second run writes nothing", async () => {
    // Arms with identity A^-1: score = b·x + ||x||. Arm A rewards feature 0,
    // arm B rewards feature 1; users carry one-hot stored feature vectors, so
    // u1,u3,u4 (x=e0) → A and u2,u5 (x=e1) → B regardless of Math.random.
    const { agent, variantA, variantB, names } = await createPushAgent("linucb");
    const persona = await createPersona({ name: "Char Persona" });
    const winsOn = (dim: number) => unitVector(dim).map((x) => x * 10);
    await prisma.linUCBArm.createMany({
      data: [
        { agentId: agent.id, variantId: variantA.id, aInv: identityMatrix(), b: winsOn(0) },
        { agentId: agent.id, variantId: variantB.id, aInv: identityMatrix(), b: winsOn(1) },
      ],
    });
    const contextDimByUser: Record<string, number> = { u1: 0, u2: 1, u3: 0, u4: 0, u5: 1 };
    for (const [id, dim] of Object.entries(contextDimByUser)) {
      await createUser(id, { personaId: persona.id, funnelStage: "wau" });
      await prisma.trackedUser.update({ where: { externalId: id }, data: { featureVector: unitVector(dim) } });
    }
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await runCron();

    const decisions = await loadDecisions(agent.id);
    const arms = await prisma.linUCBArm.findMany({
      where: { agentId: agent.id },
      orderBy: { variantId: "asc" },
      select: { variantId: true, version: true, tries: true },
    });
    expect(decisions.length).toBeGreaterThan(0);
    const armSnapshot = arms
      .map((a) => ({ variant: names.get(a.variantId) ?? a.variantId, version: a.version, tries: a.tries }))
      .sort((a, b) => a.variant.localeCompare(b.variant));
    expect(stabilize({ ...sendSnapshot(decisions), arms: armSnapshot }, names)).toMatchSnapshot();

    // Second run in the same frozen instant: every user was just sent to, so
    // nothing new may be decided, sent, or written to the arms.
    brazeRequests = [];
    await runCron();

    expect(brazeRequests).toEqual([]);
    expect(await prisma.userDecision.count({ where: { agentId: agent.id } })).toBe(decisions.length);
    const armsAfterSecondRun = await prisma.linUCBArm.findMany({
      where: { agentId: agent.id },
      orderBy: { variantId: "asc" },
      select: { variantId: true, version: true, tries: true },
    });
    expect(armsAfterSecondRun).toEqual(arms);
  });
});
