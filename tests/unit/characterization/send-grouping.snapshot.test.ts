// CHARACTERIZATION (P0 safety net, spec 2026-10-13 §10): freezes the current
// output of groupDecisionsByVariant across every channel before the pluggable
// refactor. A diff here means send behaviour changed. Update the snapshot
// (`bun test -u`) ONLY when the change is intended and reviewed.
import { describe, expect, it } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta, type VariantSendGroup } from "@/lib/cron/send-grouping";
import { GIVING_LINK_SENTINEL } from "@/lib/engine/giving-link";

function meta(overrides: Partial<VariantMeta> = {}): VariantMeta {
  return {
    channel: "push",
    body: "hello",
    title: "Title",
    deeplink: "app://home",
    brazeCampaignId: "camp-1",
    brazeVariantId: "var-1",
    givingHandleStrategy: null,
    iconImageUrl: null,
    cta: null,
    ...overrides,
  };
}

const user = (externalId: string, brazeId: string | null = null, attributes: unknown = {}) => ({
  externalId,
  brazeId,
  attributes,
});

function normalizeGroups(groups: Record<string, VariantSendGroup>): unknown {
  return Object.keys(groups)
    .sort()
    .map((key) => {
      const g = groups[key];
      return {
        key,
        ...g,
        scheduledAt: g.scheduledAt ? g.scheduledAt.toISOString() : null,
        externalUserIds: [...g.externalUserIds].sort(),
        decisionIds: [...g.decisionIds].sort(),
        brazeOnlyIds: [...g.brazeOnlyIds].sort(),
      };
    });
}

const AT = new Date("2026-05-30T12:00:00Z");
const LATER = new Date("2026-05-30T18:30:00Z");

describe("characterization: groupDecisionsByVariant", () => {
  it("groups every channel the same way it did before the refactor", () => {
    const variantMeta = new Map<string, VariantMeta>([
      ["v-push", meta()],
      ["v-email", meta({ channel: "email", title: "Subject", body: "<p>Hi</p>", brazeVariantId: "var-email" })],
      ["v-card", meta({ channel: "content-card", cta: "Read", brazeVariantId: "var-card" })],
      ["v-slideup", meta({ channel: "in-app", title: null, brazeVariantId: "var-slide" })],
      ["v-modal", meta({ channel: "modal-iam", cta: "Open", brazeVariantId: "var-modal" })],
      ["v-give", meta({ deeplink: GIVING_LINK_SENTINEL, brazeVariantId: "var-give" })],
    ]);
    const decisionIdByUser = new Map([
      ["u1", "d1"], ["u2", "d2"], ["braze-abc", "d3"], ["u4", "d4"],
      ["u5", "d5"], ["u6", "d6"], ["u7", "d7"], ["u8", "d8"],
      // u9 has no decision id → must be dropped
    ]);

    const groups = groupDecisionsByVariant(
      [
        { user: user("u1"), variantId: "v-push", scheduledAt: AT, inLocalTime: false },
        { user: user("u2"), variantId: "v-push", scheduledAt: AT, inLocalTime: true },
        { user: user("braze-abc", "braze-abc"), variantId: "v-push", scheduledAt: AT, inLocalTime: false },
        { user: user("u4", null, { language_tag: "es" }), variantId: "v-push", scheduledAt: LATER, inLocalTime: false },
        { user: user("u5"), variantId: "v-email", scheduledAt: AT, inLocalTime: false },
        { user: user("u6"), variantId: "v-card", scheduledAt: AT, inLocalTime: false },
        { user: user("u7"), variantId: "v-slideup", scheduledAt: AT, inLocalTime: false },
        { user: user("u8", null, { gift_amount_most_recent: 40 }), variantId: "v-give", scheduledAt: AT, inLocalTime: false },
        { user: user("u9"), variantId: "v-modal", scheduledAt: AT, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );

    expect(normalizeGroups(groups)).toMatchSnapshot();
  });
});
