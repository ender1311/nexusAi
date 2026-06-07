import { describe, expect, it } from "bun:test";
import { buildMessagingTimeline } from "@/lib/users/messaging-history";

const variant = { name: "Var A", title: "Hello", message: { agent: { name: "Agent X" } } };

describe("buildMessagingTimeline", () => {
  it("expands a sent-only decision into a single sent event", () => {
    const events = buildMessagingTimeline([{
      id: "d1", sentAt: "2026-06-01T10:00:00.000Z", channel: "push",
      pushOpenAt: null, conversionAt: null, conversionEvent: null, reward: null, variant,
    }]);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("sent");
    expect(events[0]!.id).toBe("d1:sent");
    expect(events[0]!.agentName).toBe("Agent X");
    expect(events[0]!.variantName).toBe("Var A");
  });

  it("expands sent + open + conversion into three events sorted by time desc", () => {
    const events = buildMessagingTimeline([{
      id: "d1", sentAt: "2026-06-01T10:00:00.000Z", channel: "push",
      pushOpenAt: "2026-06-01T11:00:00.000Z", conversionAt: "2026-06-01T12:00:00.000Z",
      conversionEvent: "gift_given", reward: 5, variant,
    }]);
    expect(events.map((e) => e.type)).toEqual(["conversion", "open", "sent"]);
    const conv = events.find((e) => e.type === "conversion")!;
    expect(conv.conversionEvent).toBe("gift_given");
    expect(conv.reward).toBe(5);
  });

  it("sorts events across multiple decisions newest-first", () => {
    const events = buildMessagingTimeline([
      { id: "old", sentAt: "2026-05-01T10:00:00.000Z", channel: "push", pushOpenAt: null, conversionAt: null, conversionEvent: null, reward: null, variant },
      { id: "new", sentAt: "2026-06-01T10:00:00.000Z", channel: "email", pushOpenAt: null, conversionAt: null, conversionEvent: null, reward: null, variant },
    ]);
    expect(events.map((e) => e.decisionId)).toEqual(["new", "old"]);
  });

  it("tolerates a null variant", () => {
    const events = buildMessagingTimeline([{
      id: "d1", sentAt: "2026-06-01T10:00:00.000Z", channel: "push",
      pushOpenAt: null, conversionAt: null, conversionEvent: null, reward: null, variant: null,
    }]);
    expect(events[0]!.variantName).toBeNull();
    expect(events[0]!.agentName).toBeNull();
  });
});
