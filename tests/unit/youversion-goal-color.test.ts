import { describe, expect, it } from "bun:test";
import { goalColorGroup, YOUVERSION_GOALS } from "@/lib/constants/youversion";

describe("goalColorGroup", () => {
  it("colors gift + sower green", () => {
    expect(goalColorGroup({ eventName: "gift_given", weight: 10 })).toBe("green");
    expect(goalColorGroup({ eventName: "sower_subscribed", weight: 10 })).toBe("green");
  });

  it("colors any negative outcome red", () => {
    expect(goalColorGroup({ eventName: "push_unsubscribe", weight: -10 })).toBe("red");
    expect(goalColorGroup({ eventName: "app_uninstall", weight: -10 })).toBe("red");
    // Negative weight wins even for an otherwise-green event name.
    expect(goalColorGroup({ eventName: "gift_given", weight: -1 })).toBe("red");
  });

  it("colors every other positive goal blue", () => {
    expect(goalColorGroup({ eventName: "session_start", weight: 3 })).toBe("blue");
    expect(goalColorGroup({ eventName: "plan_started", weight: 7 })).toBe("blue");
    expect(goalColorGroup({ eventName: "guided_scripture_start", weight: 7 })).toBe("blue");
    expect(goalColorGroup({ eventName: "video_start", weight: 5 })).toBe("blue");
  });

  it("classifies the full preset list with no unexpected groups", () => {
    for (const g of YOUVERSION_GOALS) {
      expect(["green", "blue", "red"]).toContain(goalColorGroup(g));
    }
  });
});
