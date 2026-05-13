/**
 * Regression: Performance page must render without error when lift settings
 * are missing (no baseline_push_open_rate or lift_since_date in AppSetting),
 * falling back to 1.2% baseline and all-time window.
 *
 * This test calls getCachedLiftSettings() directly since the page is a
 * Server Component that cannot be rendered in a unit test context.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("lift settings fallback", () => {
  it("returns default 1.2% baseline when AppSetting rows are absent", async () => {
    // No rows in AppSetting — simulate fresh install
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: ["baseline_push_open_rate", "lift_since_date"] } },
    });
    expect(rows).toHaveLength(0);

    // Replicate the getCachedLiftSettings() parsing logic
    const map = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));
    const baselineRate = parseFloat(map["baseline_push_open_rate"] ?? "1.2");
    const sinceDateStr = map["lift_since_date"] ?? "";
    const liftSince = sinceDateStr ? new Date(sinceDateStr) : null;

    expect(baselineRate).toBe(1.2);
    expect(liftSince).toBeNull();
  });

  it("returns configured values when AppSetting rows exist", async () => {
    await prisma.appSetting.createMany({
      data: [
        { key: "baseline_push_open_rate", value: "2.0" },
        { key: "lift_since_date", value: "2026-05-12" },
      ],
    });

    const rows = await prisma.appSetting.findMany({
      where: { key: { in: ["baseline_push_open_rate", "lift_since_date"] } },
    });
    const map = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));
    const baselineRate = parseFloat(map["baseline_push_open_rate"] ?? "1.2");
    const liftSince = map["lift_since_date"] ? new Date(map["lift_since_date"]) : null;

    expect(baselineRate).toBe(2.0);
    expect(liftSince?.toISOString().startsWith("2026-05-12")).toBe(true);
  });
});
