import { describe, it, expect } from "bun:test";
import { selectAudience, trimToCap, resolveFetchLimit, MAX_FETCH_LIMIT } from "@/lib/cron/caps";

// Deterministic RNG: returns 0 so Fisher-Yates becomes a no-op (stable order).
const noShuffle = () => 0;

describe("resolveFetchLimit", () => {
  it("uses audienceCap verbatim when set", () => {
    expect(resolveFetchLimit(250, 500)).toBe(250);
    expect(resolveFetchLimit(250, null)).toBe(250);
  });

  it("derives 2× dailySendCap when audienceCap is null", () => {
    expect(resolveFetchLimit(null, 500)).toBe(1000);
  });

  it("falls back to the safety ceiling when both caps are null (explicit-unlimited)", () => {
    expect(resolveFetchLimit(null, null)).toBe(MAX_FETCH_LIMIT);
  });

  it("respects an explicit cap larger than the ceiling", () => {
    expect(resolveFetchLimit(200_000, null)).toBe(200_000);
  });
});

describe("trimToCap", () => {
  it("keeps everything when under quota", () => {
    expect(trimToCap(["a", "b"], 5)).toEqual({ kept: ["a", "b"], suppressed: 0 });
  });

  it("trims to the remaining quota and reports suppressed count", () => {
    expect(trimToCap(["a", "b", "c", "d"], 2)).toEqual({ kept: ["a", "b"], suppressed: 2 });
  });

  it("drops everything when remaining is zero or negative", () => {
    expect(trimToCap(["a", "b"], 0)).toEqual({ kept: [], suppressed: 2 });
    expect(trimToCap(["a", "b"], -3)).toEqual({ kept: [], suppressed: 2 });
  });
});

describe("selectAudience — plain lottery", () => {
  it("keeps up to the cap and suppresses the rest", () => {
    const res = selectAudience(["a", "b", "c", "d"], {
      audienceCap: 2,
      prioritizeLastSeen: false,
      currentHour: 12,
      preferredHourByUser: new Map(),
      random: noShuffle,
    });
    expect(res.kept).toHaveLength(2);
    expect(res.suppressed).toBe(2);
  });

  it("keeps everyone when cap exceeds pool", () => {
    const res = selectAudience(["a", "b"], {
      audienceCap: 10,
      prioritizeLastSeen: false,
      currentHour: 12,
      preferredHourByUser: new Map(),
      random: noShuffle,
    });
    expect(res.kept.sort()).toEqual(["a", "b"]);
    expect(res.suppressed).toBe(0);
  });
});

describe("selectAudience — prioritizeLastSeen", () => {
  it("prefers users whose preferred hour is within ±1 of now, defers far ones (not suppressed)", () => {
    const preferred = new Map<string, number | null>([
      ["match-now", 12],
      ["match-adjacent", 13],
      ["far", 3],
      ["no-pref", null],
    ]);
    const res = selectAudience(["match-now", "match-adjacent", "far", "no-pref"], {
      audienceCap: 10,
      prioritizeLastSeen: true,
      currentHour: 12,
      preferredHourByUser: preferred,
      random: noShuffle,
    });
    // far user deferred to its matching hourly run — neither kept nor suppressed
    expect(res.kept.sort()).toEqual(["match-adjacent", "match-now", "no-pref"]);
    expect(res.suppressed).toBe(0);
  });

  it("wraps adjacency across midnight", () => {
    const preferred = new Map<string, number | null>([["late", 23]]);
    const res = selectAudience(["late"], {
      audienceCap: 10,
      prioritizeLastSeen: true,
      currentHour: 0,
      preferredHourByUser: preferred,
      random: noShuffle,
    });
    expect(res.kept).toEqual(["late"]);
  });

  it("places time-matched users ahead of no-preference users under a tight cap", () => {
    const preferred = new Map<string, number | null>([
      ["match", 12],
      ["no-pref", null],
    ]);
    const res = selectAudience(["no-pref", "match"], {
      audienceCap: 1,
      prioritizeLastSeen: true,
      currentHour: 12,
      preferredHourByUser: preferred,
      random: noShuffle,
    });
    expect(res.kept).toEqual(["match"]);
    expect(res.suppressed).toBe(1);
  });
});
