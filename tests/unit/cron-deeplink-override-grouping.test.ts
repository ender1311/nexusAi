import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";

function meta(overrides: Partial<VariantMeta> = {}): VariantMeta {
  return {
    channel: "push",
    body: "hello",
    title: "Title",
    deeplink: "https://www.bible.com/verse-of-the-day",
    brazeCampaignId: "camp-1",
    brazeVariantId: "var-1",
    givingHandleStrategy: null,
    iconImageUrl: null,
    ...overrides,
  };
}
const user = (externalId: string) => ({ externalId, brazeId: null, attributes: {} });

describe("deeplink override collapses send groups", () => {
  it("users on the same variant with the overridden link form one group", () => {
    const variantMeta = new Map<string, VariantMeta>([["v1", meta()]]);
    const decisionIdByUser = new Map([["u1", "d1"], ["u2", "d2"]]);
    const at = new Date("2026-06-05T12:00:00Z");

    const groups = groupDecisionsByVariant(
      [
        { user: user("u1"), variantId: "v1", scheduledAt: at, inLocalTime: false },
        { user: user("u2"), variantId: "v1", scheduledAt: at, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );
    expect(Object.values(groups)).toHaveLength(1);
  });

  it("two variants overridden to the SAME url still group per variant (groupKey includes variantId)", () => {
    const sameUrl = "https://www.bible.com/verse-of-the-day";
    const variantMeta = new Map<string, VariantMeta>([
      ["v1", meta({ deeplink: sameUrl })],
      ["v2", meta({ deeplink: sameUrl })],
    ]);
    const decisionIdByUser = new Map([["u1", "d1"], ["u2", "d2"]]);
    const at = new Date("2026-06-05T12:00:00Z");
    const groups = groupDecisionsByVariant(
      [
        { user: user("u1"), variantId: "v1", scheduledAt: at, inLocalTime: false },
        { user: user("u2"), variantId: "v2", scheduledAt: at, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );
    expect(Object.values(groups)).toHaveLength(2);
  });
});
