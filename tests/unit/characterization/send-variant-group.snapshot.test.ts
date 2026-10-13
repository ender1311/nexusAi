// CHARACTERIZATION (P0 safety net, spec 2026-10-13 §10): freezes the exact
// Braze endpoints + request bodies + DB side-effects sendVariantGroup produces
// per channel. This is the contract the future Activator(braze) adapter must
// reproduce byte-for-byte. Update with `bun test -u` only for reviewed changes.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { sendVariantGroup, type VariantSendGroup } from "@/lib/cron/send-grouping";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { FakeFetch } from "../../helpers/braze";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const scrub = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null).replace(UUID_RE, "<uuid>"));

function recordingPrisma() {
  const calls: Array<{ op: string; args: unknown }> = [];
  const client = {
    userDecision: {
      updateMany: async (args: unknown) => { calls.push({ op: "userDecision.updateMany", args: scrub(args) }); return { count: 1 }; },
    },
    failedBrazeSend: {
      create: async (args: unknown) => { calls.push({ op: "failedBrazeSend.create", args: scrub(args) }); return {}; },
    },
  };
  return { client: client as unknown as typeof import("@/lib/db").prisma, calls };
}

const ENV = {
  BRAZE_API_KEY: "test_key",
  BRAZE_REST_ENDPOINT: "https://rest.test.braze.com",
  BRAZE_NEXUS_CAMPAIGN_ID: "nexus-campaign",
  BRAZE_CONTENT_CARD_CAMPAIGN_ID: "cc-campaign",
  BRAZE_NEXUS_SLIDEUP_CANVAS_ID: "slideup-canvas",
  BRAZE_NEXUS_MODAL_CANVAS_ID: "modal-canvas",
  BRAZE_IOS_APP_ID: "ios-app",
  BRAZE_ANDROID_APP_ID: "android-app",
};
const NOW = new Date("2026-05-30T12:00:00Z");
const FUTURE = new Date("2026-05-30T15:00:00Z"); // > 2 min out → schedule endpoints

function group(channel: string, scheduledAt: Date, extra: Partial<VariantSendGroup> = {}): VariantSendGroup {
  return {
    variantId: `v-${channel}`,
    brazeVariantId: `bv-${channel}`,
    brazeCampaignId: "db-campaign",
    channel,
    title: channel === "in-app" ? null : "Title",
    body: channel === "email" ? "<p>Body</p>" : "Body",
    cta: "Open",
    deeplink: "youversion://home",
    iosImageUrl: null,
    androidImageUrl: null,
    inLocalTime: false,
    scheduledAt,
    externalUserIds: ["u1", "braze-only-1"],
    brazeOnlyIds: new Set(["braze-only-1"]),
    decisionIds: ["d1", "d2"],
    ...extra,
  };
}

let fake: FakeFetch;
let originalFetch: typeof globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  setSystemTime(NOW);
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setSystemTime();
});
beforeEach(() => { fake = new FakeFetch(); originalFetch = globalThis.fetch; globalThis.fetch = fake.fetch as typeof fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

async function run(g: VariantSendGroup) {
  const { client, calls } = recordingPrisma();
  const result = await sendVariantGroup(
    g, g.externalUserIds, g.decisionIds, createBrazeClient(), new PayloadFactory(), "agent-1", client,
  );
  return {
    result,
    requests: fake.requests.map((r) => ({ method: r.method, url: r.url, body: scrub(r.body) })),
    db: calls,
  };
}

describe("characterization: sendVariantGroup Braze contract", () => {
  for (const channel of ["push", "email", "sms", "content-card", "in-app", "modal-iam"]) {
    it(`${channel} — immediate`, async () => {
      expect(await run(group(channel, NOW))).toMatchSnapshot();
    });
    it(`${channel} — scheduled`, async () => {
      fake.queueResponse({ message: "success", schedule_id: "sched-1" }, 201);
      expect(await run(group(channel, FUTURE))).toMatchSnapshot();
    });
  }

  // sendVariantGroup routes push/email/sms to /messages/send only when scheduledAt is
  // unset; any scheduledAt (even "now") goes to /messages/schedule/create.
  for (const channel of ["push", "email", "sms"]) {
    it(`${channel} — no scheduledAt`, async () => {
      expect(await run(group(channel, NOW, { scheduledAt: undefined }))).toMatchSnapshot();
    });
  }

  it("push — Braze 400 records FailedBrazeSend", async () => {
    fake.queueResponse({ message: "Invalid request" }, 400);
    expect(await run(group("push", NOW))).toMatchSnapshot();
  });
});
