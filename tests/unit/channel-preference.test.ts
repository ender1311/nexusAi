import { describe, expect, it } from "bun:test";
import {
  isPushPreferred,
  isPushTargetingMode,
  DEFAULT_PUSH_TARGETING_MODE,
  PUSH_TARGETING_MODES,
  type PushTargetingMode,
} from "@/lib/engine/channel-preference";

const noStats = {};

describe("isPushTargetingMode / constants", () => {
  it("default mode is broad (gate disabled until opted in)", () => {
    expect(DEFAULT_PUSH_TARGETING_MODE).toBe("broad");
  });
  it("recognizes valid modes and rejects others", () => {
    for (const m of PUSH_TARGETING_MODES) expect(isPushTargetingMode(m)).toBe(true);
    expect(isPushTargetingMode("nonsense")).toBe(false);
    expect(isPushTargetingMode(undefined)).toBe(false);
    expect(isPushTargetingMode(3)).toBe(false);
  });
});

describe("isPushPreferred — broad mode", () => {
  it("always eligible regardless of preference", () => {
    expect(isPushPreferred({ preferred_channel_external_30_days: "email" }, noStats, "dau4", "broad")).toBe(true);
    expect(isPushPreferred({}, noStats, "mau", "broad")).toBe(true);
  });
});

describe("isPushPreferred — new-stage exemption", () => {
  for (const mode of PUSH_TARGETING_MODES) {
    it(`new/new_user always eligible in ${mode} mode even with email preference`, () => {
      const attrs = { preferred_channel_external_30_days: "email", preferred_channel_external_90_days: "email" };
      expect(isPushPreferred(attrs, noStats, "new", mode)).toBe(true);
      expect(isPushPreferred(attrs, noStats, "new_user", mode)).toBe(true);
    });
  }
});

describe("isPushPreferred — strict mode stage windows", () => {
  it("dau4 reads 30d window: push → eligible", () => {
    expect(
      isPushPreferred(
        { preferred_channel_external_30_days: "push_notification", preferred_channel_external_90_days: "email" },
        noStats,
        "dau4",
        "strict"
      )
    ).toBe(true);
  });

  it("dau4 reads 30d window: email → excluded even if 90d is push", () => {
    expect(
      isPushPreferred(
        { preferred_channel_external_30_days: "email", preferred_channel_external_90_days: "push_notification" },
        noStats,
        "dau4",
        "strict"
      )
    ).toBe(false);
  });

  it("wau reads 30d window like dau4", () => {
    expect(isPushPreferred({ preferred_channel_external_30_days: "push" }, noStats, "wau", "strict")).toBe(true);
  });

  it("mau reads 90d window: push → eligible", () => {
    expect(
      isPushPreferred(
        { preferred_channel_external_30_days: "email", preferred_channel_external_90_days: "push" },
        noStats,
        "mau",
        "strict"
      )
    ).toBe(true);
  });

  it("lapsed_mau reads 90d window: email → excluded", () => {
    expect(
      isPushPreferred({ preferred_channel_external_90_days: "email" }, noStats, "lapsed_mau", "strict")
    ).toBe(false);
  });

  it("strict excludes when primary window absent (no fallback)", () => {
    expect(isPushPreferred({}, noStats, "dau4", "strict")).toBe(false);
  });

  it("strict treats empty string as no signal → excluded", () => {
    expect(isPushPreferred({ preferred_channel_external_30_days: "  " }, noStats, "dau4", "strict")).toBe(false);
  });
});

describe("isPushPreferred — permissive cascade", () => {
  it("primary external push → eligible", () => {
    expect(isPushPreferred({ preferred_channel_external_30_days: "push" }, noStats, "dau4", "permissive")).toBe(true);
  });

  it("primary external email → excluded (hard signal, no fallthrough)", () => {
    expect(
      isPushPreferred(
        { preferred_channel_external_30_days: "email", preferred_channel_overall_30_days: "push" },
        noStats,
        "dau4",
        "permissive"
      )
    ).toBe(false);
  });

  it("falls through to other external window when primary empty", () => {
    expect(
      isPushPreferred(
        { preferred_channel_external_30_days: "", preferred_channel_external_90_days: "push" },
        noStats,
        "dau4",
        "permissive"
      )
    ).toBe(true);
  });

  it("falls through to overall window when both external empty", () => {
    expect(
      isPushPreferred({ preferred_channel_overall_30_days: "email" }, noStats, "dau4", "permissive")
    ).toBe(false);
    expect(
      isPushPreferred({ preferred_channel_overall_90_days: "push" }, noStats, "dau4", "permissive")
    ).toBe(true);
  });

  it("falls back to channelStats when all windows empty: push converts more → eligible", () => {
    const stats = { push: { sent: 10, converted: 5 }, email: { sent: 10, converted: 2 } };
    expect(isPushPreferred({}, stats, "dau4", "permissive")).toBe(true);
  });

  it("channelStats email converts more → excluded", () => {
    const stats = { push: { sent: 10, converted: 1 }, email: { sent: 10, converted: 4 } };
    expect(isPushPreferred({}, stats, "dau4", "permissive")).toBe(false);
  });

  it("channelStats tie broken by sends favoring push", () => {
    const stats = { push: { sent: 5, converted: 2 }, email: { sent: 4, converted: 2 } };
    expect(isPushPreferred({}, stats, "dau4", "permissive")).toBe(true);
  });

  it("no data anywhere → eligible (preserve reach)", () => {
    expect(isPushPreferred({}, noStats, "dau4", "permissive")).toBe(true);
    expect(isPushPreferred({}, undefined, "mau", "permissive")).toBe(true);
  });
});

describe("isPushPreferred — value normalization", () => {
  it("uppercases / whitespace / push_notification all normalize to push", () => {
    expect(isPushPreferred({ preferred_channel_external_30_days: "  PUSH  " }, noStats, "dau4", "strict")).toBe(true);
    expect(
      isPushPreferred({ preferred_channel_external_30_days: "Push_Notification" }, noStats, "dau4", "strict")
    ).toBe(true);
  });

  it("non-string values treated as no signal", () => {
    expect(isPushPreferred({ preferred_channel_external_30_days: 42 }, noStats, "dau4", "strict")).toBe(false);
    expect(isPushPreferred({ preferred_channel_external_30_days: null }, noStats, "dau4", "strict")).toBe(false);
  });

  it("in_app_message / content_card are non-push → excluded", () => {
    const mode: PushTargetingMode = "permissive";
    expect(isPushPreferred({ preferred_channel_external_30_days: "in_app_message" }, noStats, "dau4", mode)).toBe(false);
    expect(isPushPreferred({ preferred_channel_external_30_days: "content_card" }, noStats, "dau4", mode)).toBe(false);
  });
});
