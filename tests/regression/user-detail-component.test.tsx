import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UserDetail, type UserDetailData } from "@/components/users/user-detail";

const data: UserDetailData = {
  user: {
    externalId: "ext-1", brazeId: "b1", personaId: "p1", personaName: "Engaged",
    personaConfidence: 0.8, funnelStage: "wau", funnelStageUpdatedAt: "2026-06-01T00:00:00.000Z",
    timezone: "America/New_York", preferredSendHour: 9, preferredSendMinute: 30,
    createdAt: "2026-01-01T00:00:00.000Z", totalDecisions: 5, totalConversions: 2, totalReward: 12.5,
  },
  attributes: { email: "a@b.com", name: "Ann", language_tag: "en" },
  channelStats: { push: { sent: 3, converted: 1 } },
  messagingHistory: [
    { id: "d1:sent", decisionId: "d1", type: "sent", time: "2026-06-05T10:00:00.000Z", channel: "push", agentName: "Agent X", variantName: "Var A", variantTitle: "Hello", conversionEvent: null, reward: null },
  ],
  armStats: [],
  gifts: { count: 0, totalUsd: 0, mostRecent: null },
};

describe("UserDetail", () => {
  it("renders identity, pinned email, and a messaging event", () => {
    const html = renderToStaticMarkup(<UserDetail data={data} />);
    expect(html).toContain("ext-1");
    expect(html).toContain("Engaged");
    expect(html).toContain("a@b.com");
    expect(html).toContain("Var A");
  });

  it("renders the raw all-properties table inside a details element", () => {
    const html = renderToStaticMarkup(<UserDetail data={data} />);
    expect(html).toContain("language_tag");
    expect(html).toContain("<details");
  });

  it("renders an empty messaging-history note when there are no events", () => {
    const html = renderToStaticMarkup(<UserDetail data={{ ...data, messagingHistory: [] }} />);
    expect(html).toContain("No messages in the last 30 days");
  });
});
