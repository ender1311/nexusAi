// Unit test for latestRunAt() — the "Last synced" value in the data-ingest
// health banner.
//
// Bug: the banner sorted lastRunAt with a bare `.sort()` (lexical string order).
// ISO timestamps with differing timezone offsets don't compare correctly as raw
// strings, so the wrong run could be reported as the most recent. The fix sorts
// by parsed epoch time.

import { describe, expect, it } from "bun:test";
import { latestRunAt } from "@/components/data-ingest/health-banner";
import type { HightouchSync } from "@/lib/hightouch/types";

function sync(lastRunAt: string | null): HightouchSync {
  return {
    id: "s",
    name: null,
    slug: "s",
    status: "success",
    primaryKey: "id",
    modelId: "m",
    destinationId: "d",
    schedule: null,
    lastRunAt,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    configuration: {},
  };
}

describe("latestRunAt", () => {
  it("returns null when no sync has run", () => {
    expect(latestRunAt([sync(null), sync(null)])).toBeNull();
    expect(latestRunAt([])).toBeNull();
  });

  it("picks the chronologically latest run", () => {
    const result = latestRunAt([
      sync("2026-06-01T10:00:00Z"),
      sync("2026-06-03T08:00:00Z"),
      sync("2026-06-02T23:00:00Z"),
    ]);
    expect(result).toBe("2026-06-03T08:00:00Z");
  });

  it("compares chronologically across timezone offsets, not lexically", () => {
    // "2026-06-01T23:00:00+05:00" == 18:00:00Z, which is EARLIER than
    // "2026-06-01T20:00:00Z". A lexical sort would wrongly pick the "+05:00"
    // string (because "2" > "2" then "3" > "0" at the hour position).
    const result = latestRunAt([
      sync("2026-06-01T23:00:00+05:00"), // 18:00Z — earlier
      sync("2026-06-01T20:00:00Z"), // 20:00Z — actually latest
    ]);
    expect(result).toBe("2026-06-01T20:00:00Z");
  });

  it("ignores nulls when some syncs have never run", () => {
    const result = latestRunAt([
      sync(null),
      sync("2026-06-01T10:00:00Z"),
      sync(null),
    ]);
    expect(result).toBe("2026-06-01T10:00:00Z");
  });
});
