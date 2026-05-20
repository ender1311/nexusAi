import { describe, expect, it } from "bun:test";
import { BrazeAnalytics } from "@/lib/braze/analytics";
import { BrazeClient } from "@/lib/braze/client";

// ---------------------------------------------------------------------------
// normalizeMetrics — static, pure
// ---------------------------------------------------------------------------

describe("BrazeAnalytics.normalizeMetrics", () => {
  it("fills missing numeric fields with 0", () => {
    const result = BrazeAnalytics.normalizeMetrics({});
    expect(result.sent).toBe(0);
    expect(result.total_opens).toBe(0);
    expect(result.unique_clicks).toBe(0);
    expect(result.bounces).toBe(0);
  });

  it("aliases sends → sent when only sends is present", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sends: 100 });
    expect(result.sent).toBe(100);
    expect(result.sends).toBe(100);
  });

  it("aliases sent → sends when only sent is present", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sent: 200 });
    expect(result.sends).toBe(200);
    expect(result.sent).toBe(200);
  });

  it("does not override existing sent when both sent and sends are present", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sent: 50, sends: 100 });
    // sent present → sends not overridden; sends present → sent not overridden
    expect(result.sent).toBe(50);
    expect(result.sends).toBe(100);
  });

  it("aliases opens → total_opens when only opens is present", () => {
    const result = BrazeAnalytics.normalizeMetrics({ opens: 40 });
    expect(result.total_opens).toBe(40);
  });

  it("aliases total_opens → opens when only total_opens is present", () => {
    const result = BrazeAnalytics.normalizeMetrics({ total_opens: 30 });
    expect(result.opens).toBe(30);
  });

  it("computes open_rate from unique_opens / sent * 100", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sent: 1000, unique_opens: 250 });
    expect(result.open_rate).toBeCloseTo(25.0, 1);
  });

  it("prefers unique_opens over total_opens for open_rate numerator", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sent: 100, unique_opens: 30, total_opens: 50 });
    expect(result.open_rate).toBeCloseTo(30.0, 1);
  });

  it("falls back to total_opens for open_rate when unique_opens is 0", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sent: 100, total_opens: 40 });
    expect(result.open_rate).toBeCloseTo(40.0, 1);
  });

  it("computes click_rate from unique_clicks / sent * 100", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sent: 200, unique_clicks: 10 });
    expect(result.click_rate).toBeCloseTo(5.0, 1);
  });

  it("prefers unique_clicks over clicks for click_rate numerator", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sent: 100, unique_clicks: 5, clicks: 12 });
    expect(result.click_rate).toBeCloseTo(5.0, 1);
  });

  it("does not compute open_rate or click_rate when sent is 0 (avoids division by zero)", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sent: 0, unique_opens: 10 });
    expect(result.open_rate).toBeUndefined();
    expect(result.click_rate).toBeUndefined();
  });

  it("open_rate is rounded to 2 decimal places", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sent: 3, unique_opens: 1 });
    // 1/3 * 100 = 33.333… → 33.33
    expect(result.open_rate).toBe(33.33);
  });

  it("passes through arbitrary extra fields", () => {
    const result = BrazeAnalytics.normalizeMetrics({ sent: 100, conversions: 7 });
    expect(result.conversions).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// aggregateDataSeries — tested via fetchCampaignAnalytics with a mock client
// ---------------------------------------------------------------------------

function makeMockClient(responseBody: unknown, ok = true): BrazeClient {
  return {
    get: async () => ({
      ok,
      json: async () => responseBody,
    }),
  } as unknown as BrazeClient;
}

describe("BrazeAnalytics.fetchCampaignAnalytics (aggregateDataSeries)", () => {
  it("returns null when client.get returns non-ok", async () => {
    const analytics = new BrazeAnalytics(makeMockClient({}, false));
    const result = await analytics.fetchCampaignAnalytics("cmp_1");
    expect(result).toBeNull();
  });

  it("returns empty normalized metrics for empty data array", async () => {
    const analytics = new BrazeAnalytics(makeMockClient({ data: [] }));
    const result = await analytics.fetchCampaignAnalytics("cmp_1");
    expect(result).not.toBeNull();
    expect(result!.sent).toBe(0);
  });

  it("sums top-level numeric fields across data points (excludes time and rate fields)", () => {
    const analytics = new BrazeAnalytics(makeMockClient({
      data: [
        { time: "2026-01-01", sent: 100, bounces: 2, open_rate: 0.25 },
        { time: "2026-01-02", sent: 150, bounces: 3, open_rate: 0.20 },
      ],
    }));
    return analytics.fetchCampaignAnalytics("cmp_1").then((result) => {
      expect(result!.sent).toBe(250);    // summed
      expect(result!.bounces).toBe(5);   // summed
      expect(result).not.toHaveProperty("time");
      // open_rate excluded from accumulation (contains "rate")
      // but normalizeMetrics adds derived open_rate — check sent was not double-counted
    });
  });

  it("walks nested messages → variations → stats structure", async () => {
    const analytics = new BrazeAnalytics(makeMockClient({
      data: [
        {
          time: "2026-01-01",
          messages: {
            ios_push: [
              { direct_opens: 20, total_opens: 25 },
            ],
          },
        },
      ],
    }));
    const result = await analytics.fetchCampaignAnalytics("cmp_1");
    expect(result!.direct_opens).toBe(20);
    expect(result!.total_opens).toBe(25);
  });

  it("messages block is first-write-wins — subsequent channel stats for same key are skipped", async () => {
    // The !(k in totals) guard means once ios_push sets direct_opens=20, android_push's 15 is skipped.
    // This is intentional: messages block is a fallback for when top-level totals are absent.
    const analytics = new BrazeAnalytics(makeMockClient({
      data: [
        {
          messages: {
            ios_push: [{ direct_opens: 20 }],
            android_push: [{ direct_opens: 15 }],
          },
        },
      ],
    }));
    const result = await analytics.fetchCampaignAnalytics("cmp_1");
    expect(result!.direct_opens).toBe(20); // android_push's 15 was not added
  });

  it("skips non-array variation values without throwing", async () => {
    const analytics = new BrazeAnalytics(makeMockClient({
      data: [
        {
          messages: {
            ios_push: "not_an_array",
            android_push: [{ direct_opens: 10 }],
          },
        },
      ],
    }));
    const result = await analytics.fetchCampaignAnalytics("cmp_1");
    expect(result!.direct_opens).toBe(10); // android_push counted; ios_push skipped
  });

  it("skips non-object stat entries without throwing", async () => {
    const analytics = new BrazeAnalytics(makeMockClient({
      data: [
        {
          messages: {
            ios_push: [null, undefined, "string", { direct_opens: 7 }],
          },
        },
      ],
    }));
    const result = await analytics.fetchCampaignAnalytics("cmp_1");
    expect(result!.direct_opens).toBe(7);
  });

  it("handles missing data field gracefully (treats as empty)", async () => {
    const analytics = new BrazeAnalytics(makeMockClient({ message: "ok" }));
    const result = await analytics.fetchCampaignAnalytics("cmp_1");
    expect(result).not.toBeNull();
    expect(result!.sent).toBe(0);
  });

  it("does not double-count top-level field already added from messages block", async () => {
    // Top-level total_opens and messages.ios_push.total_opens — messages block defers to totals
    // (the `!(k in totals)` guard prevents re-adding from messages if already set at top level)
    const analytics = new BrazeAnalytics(makeMockClient({
      data: [
        {
          total_opens: 50,
          messages: {
            ios_push: [{ total_opens: 30 }],
          },
        },
      ],
    }));
    const result = await analytics.fetchCampaignAnalytics("cmp_1");
    // total_opens from top level = 50; messages block skips because key already in totals
    expect(result!.total_opens).toBe(50);
  });
});
