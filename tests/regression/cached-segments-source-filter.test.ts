// tests/regression/cached-segments-source-filter.test.ts
//
// REGRESSION (audit fix #3): getCachedSegments grouped UserSegment by segmentName
// with no source filter, so rule-materialized rows (source='rule') were summed in
// with the hightouch import under the same name — inflating userCount AND surfacing
// a duplicate-looking segment row in the sizes table. The fix scopes the groupBy to
// source='hightouch'. (unstable_cache is a pass-through in tests/setup/bun.ts, so
// this exercises the real query.)

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createUserSegment } from "../helpers/builders";
import { getCachedSegments } from "@/lib/cache/segments";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: getCachedSegments counts only hightouch-sourced rows", () => {
  it("excludes rule-materialized rows from the count and does not duplicate the segment", async () => {
    // Two genuine hightouch members of "givers"…
    await createUserSegment("u1", "givers", "hightouch");
    await createUserSegment("u2", "givers", "hightouch");
    // …plus rule-materialized rows under the SAME name (must not be counted).
    await createUserSegment("u3", "givers", "rule");
    await createUserSegment("u4", "givers", "rule");
    await createUserSegment("u5", "givers", "rule");

    const segments = await getCachedSegments();
    const givers = segments.filter((s) => s.name === "givers");

    expect(givers).toHaveLength(1);
    expect(givers[0]!.userCount).toBe(2);
  });

  it("omits an orphan rule membership with no Segment definition", async () => {
    await createUserSegment("u1", "rule-only", "rule");
    const segments = await getCachedSegments();
    expect(segments.find((s) => s.name === "rule-only")).toBeUndefined();
  });

  it("includes a rule-segment DEFINITION (Segment table) so it's selectable in agent targeting", async () => {
    // A rule segment that exists as a definition but hasn't materialized members yet
    // must still appear in the picker (this was the bug: rule segments were invisible).
    await prisma.segment.create({
      data: {
        name: "giving-has-given",
        rule: { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "gift_count_lifetime", operator: "gte", value: 1 }] },
        sizeExact: 123,
      },
    });
    const segments = await getCachedSegments();
    const s = segments.find((x) => x.name === "giving-has-given");
    expect(s).toBeDefined();
    expect(s!.userCount).toBe(123); // falls back to sizeExact when no hightouch members
  });
});
