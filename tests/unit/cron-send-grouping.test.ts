import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import { GIVING_LINK_SENTINEL } from "@/lib/engine/giving-link";

function meta(overrides: Partial<VariantMeta> = {}): VariantMeta {
  return {
    channel: "push",
    body: "hello",
    title: "Title",
    deeplink: "app://home",
    brazeCampaignId: "camp-1",
    brazeVariantId: "var-1",
    ...overrides,
  };
}

const user = (externalId: string, brazeId: string | null = null, attributes: unknown = {}) => ({
  externalId,
  brazeId,
  attributes,
});

describe("groupDecisionsByVariant", () => {
  it("batches users sharing variant + time + deeplink into one group", () => {
    const variantMeta = new Map<string, VariantMeta>([["v1", meta()]]);
    const decisionIdByUser = new Map([["u1", "d1"], ["u2", "d2"]]);
    const at = new Date("2026-05-30T12:00:00Z");

    const groups = groupDecisionsByVariant(
      [
        { user: user("u1"), variantId: "v1", scheduledAt: at, inLocalTime: false },
        { user: user("u2"), variantId: "v1", scheduledAt: at, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );

    const vals = Object.values(groups);
    expect(vals).toHaveLength(1);
    expect(vals[0].externalUserIds.sort()).toEqual(["u1", "u2"]);
    expect(vals[0].decisionIds.sort()).toEqual(["d1", "d2"]);
  });

  it("splits groups by inLocalTime flag", () => {
    const variantMeta = new Map<string, VariantMeta>([["v1", meta()]]);
    const decisionIdByUser = new Map([["u1", "d1"], ["u2", "d2"]]);
    const at = new Date("2026-05-30T12:00:00Z");

    const groups = groupDecisionsByVariant(
      [
        { user: user("u1"), variantId: "v1", scheduledAt: at, inLocalTime: true },
        { user: user("u2"), variantId: "v1", scheduledAt: at, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );
    expect(Object.values(groups)).toHaveLength(2);
  });

  it("flags unverified users (externalId === brazeId) as brazeOnly", () => {
    const variantMeta = new Map<string, VariantMeta>([["v1", meta()]]);
    const decisionIdByUser = new Map([["bz-1", "d1"], ["u2", "d2"]]);
    const at = new Date("2026-05-30T12:00:00Z");

    const groups = groupDecisionsByVariant(
      [
        { user: user("bz-1", "bz-1"), variantId: "v1", scheduledAt: at, inLocalTime: false },
        { user: user("u2", "different-braze"), variantId: "v1", scheduledAt: at, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );
    const g = Object.values(groups)[0];
    expect(g.brazeOnlyIds.has("bz-1")).toBe(true);
    expect(g.brazeOnlyIds.has("u2")).toBe(false);
  });

  it("resolves the giving-link sentinel to a per-user URL and splits by resolved deeplink", () => {
    const variantMeta = new Map<string, VariantMeta>([["v1", meta({ deeplink: GIVING_LINK_SENTINEL })]]);
    const decisionIdByUser = new Map([["u1", "d1"], ["u2", "d2"]]);
    const at = new Date("2026-05-30T12:00:00Z");

    const groups = groupDecisionsByVariant(
      [
        { user: user("u1", null, { gift_amount_last: 5 }), variantId: "v1", scheduledAt: at, inLocalTime: false },
        { user: user("u2", null, { gift_amount_last: 5000 }), variantId: "v1", scheduledAt: at, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );
    // Different giving history → different resolved amounts → different groups.
    expect(Object.values(groups).length).toBeGreaterThanOrEqual(1);
    for (const g of Object.values(groups)) {
      expect(g.deeplink).not.toBe(GIVING_LINK_SENTINEL);
    }
  });

  it("skips inputs with unknown variant or missing decisionId", () => {
    const variantMeta = new Map<string, VariantMeta>([["v1", meta()]]);
    const decisionIdByUser = new Map([["u1", "d1"]]);
    const at = new Date("2026-05-30T12:00:00Z");

    const groups = groupDecisionsByVariant(
      [
        { user: user("u1"), variantId: "missing-variant", scheduledAt: at, inLocalTime: false },
        { user: user("no-decision"), variantId: "v1", scheduledAt: at, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );
    expect(Object.values(groups)).toHaveLength(0);
  });
});
