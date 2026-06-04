// Regression: the push preferred-channel send-eligibility gate must be applied
// IDENTICALLY on both cron send paths.
//   - exploration-window path: buildEligibleAgentsByUser() (pure)
//   - lottery path: inline isPushPreferred() filter in select-and-send/route.ts
// Both call the same pure isPushPreferred(); this test guards against per-path
// drift by asserting the two paths agree on every user across every mode.
// See docs/preferred-channel-sync-fix.md and src/lib/engine/channel-preference.ts
import { describe, it, expect } from "bun:test";
import {
  isPushPreferred,
  PUSH_TARGETING_MODES,
  type PushTargetingMode,
} from "@/lib/engine/channel-preference";
import {
  buildEligibleAgentsByUser,
  type ExplorationAgent,
  type ExplorationUser,
} from "@/lib/cron/exploration-window";

// Push agent with funnelStage=null so the funnel-stage filter is skipped and the
// preferred-channel gate is the only thing that can differ between users.
const pushAgent: ExplorationAgent = {
  id: "agent-1",
  funnelStage: null,
  languageFilter: null,
  targetSegmentName: null,
  segmentTargeting: null,
  personaTargets: [{ personaId: "p1" }],
  messages: [{ channel: "push" }],
};

type Fixture = { externalId: string; funnelStage: string; attributes: Record<string, unknown>; channelStats: unknown };

// Every fixture passes persona, opt-out and language filters (en, persona p1),
// so only isPushPreferred decides inclusion.
const base = { newsletter_push_enabled: true, language_tag: "en-US" };
const fixtures: Fixture[] = [
  { externalId: "email-90", funnelStage: "lapsed_mau", attributes: { ...base, preferred_channel_external_90_days: "email" }, channelStats: null },
  { externalId: "push-90", funnelStage: "lapsed_mau", attributes: { ...base, preferred_channel_external_90_days: "push_notification" }, channelStats: null },
  { externalId: "email-30", funnelStage: "dau4", attributes: { ...base, preferred_channel_external_30_days: "email" }, channelStats: null },
  { externalId: "push-30", funnelStage: "dau4", attributes: { ...base, preferred_channel_external_30_days: "push" }, channelStats: null },
  { externalId: "unknown", funnelStage: "dau4", attributes: { ...base }, channelStats: null },
  { externalId: "stats-push", funnelStage: "dau4", attributes: { ...base }, channelStats: { push: { sent: 10, converted: 5 }, email: { sent: 10, converted: 1 } } },
  { externalId: "stats-email", funnelStage: "dau4", attributes: { ...base }, channelStats: { push: { sent: 10, converted: 1 }, email: { sent: 10, converted: 5 } } },
  { externalId: "new-stage", funnelStage: "new", attributes: { ...base, preferred_channel_external_30_days: "email" }, channelStats: null },
];

function explorationUsers(): ExplorationUser[] {
  return fixtures.map((f) => ({
    externalId: f.externalId,
    personaId: "p1",
    funnelStage: f.funnelStage,
    attributes: f.attributes,
    channelStats: f.channelStats,
  }));
}

describe("push preferred-channel gate parity across cron paths", () => {
  for (const mode of PUSH_TARGETING_MODES) {
    it(`lottery and exploration paths agree for every user in ${mode} mode`, () => {
      const eligible = buildEligibleAgentsByUser([pushAgent], explorationUsers(), mode as PushTargetingMode);
      for (const f of fixtures) {
        // Lottery path: the exact inline expression used in route.ts.
        const lotteryIncluded = isPushPreferred(f.attributes, f.channelStats, f.funnelStage, mode as PushTargetingMode);
        // Exploration path: presence in the eligible map.
        const explorationIncluded = eligible.has(f.externalId);
        expect(explorationIncluded).toBe(lotteryIncluded);
      }
    });
  }

  it("strict mode excludes non-push and unknown, includes push and new-stage", () => {
    const eligible = buildEligibleAgentsByUser([pushAgent], explorationUsers(), "strict");
    expect(eligible.has("email-90")).toBe(false);
    expect(eligible.has("email-30")).toBe(false);
    expect(eligible.has("unknown")).toBe(false);
    expect(eligible.has("stats-push")).toBe(false); // strict ignores channelStats
    expect(eligible.has("push-90")).toBe(true);
    expect(eligible.has("push-30")).toBe(true);
    expect(eligible.has("new-stage")).toBe(true);
  });

  it("permissive mode includes unknown + stats-push, excludes hard non-push signals", () => {
    const eligible = buildEligibleAgentsByUser([pushAgent], explorationUsers(), "permissive");
    expect(eligible.has("unknown")).toBe(true);
    expect(eligible.has("stats-push")).toBe(true);
    expect(eligible.has("stats-email")).toBe(false);
    expect(eligible.has("email-90")).toBe(false);
    expect(eligible.has("push-30")).toBe(true);
  });

  it("broad mode includes everyone (gate disabled)", () => {
    const eligible = buildEligibleAgentsByUser([pushAgent], explorationUsers(), "broad");
    for (const f of fixtures) expect(eligible.has(f.externalId)).toBe(true);
  });
});
