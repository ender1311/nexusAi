import { describe, expect, it } from "bun:test";
import { FIELD_CATALOG } from "@/lib/segments/field-catalog";

const VALUES_FIELDS = new Set(["country_latest", "language_tag", "timezone", "preferred_channel_overall_30_days"]);
const RANGE_FIELDS = new Set(["createdAt", "days_since_last_open", "gift_count_lifetime", "push_sent", "push_converted"]);
const EXCLUDED_FIELDS = new Set(["funnelStage", "persona", "segment_membership", "email", "has_recurring_gift", "newsletter_push_enabled", "newsletter_email_enabled"]);

describe("facet classification", () => {
  it("classifies every catalog field exactly once (values | range | excluded)", () => {
    for (const f of FIELD_CATALOG) {
      const inValues = VALUES_FIELDS.has(f.id);
      const inRange = RANGE_FIELDS.has(f.id);
      const inExcluded = EXCLUDED_FIELDS.has(f.id);
      expect([inValues, inRange, inExcluded].filter(Boolean).length, `field ${f.id} must be classified once`).toBe(1);
    }
  });

  it("tags values fields with facet.kind = values", () => {
    for (const f of FIELD_CATALOG.filter((x) => VALUES_FIELDS.has(x.id))) {
      expect(f.facet, f.id).toEqual({ kind: "values" });
    }
  });

  it("tags range fields with facet.kind = range", () => {
    for (const f of FIELD_CATALOG.filter((x) => RANGE_FIELDS.has(x.id))) {
      expect(f.facet, f.id).toEqual({ kind: "range" });
    }
  });

  it("leaves excluded fields without a facet", () => {
    for (const f of FIELD_CATALOG.filter((x) => EXCLUDED_FIELDS.has(x.id))) {
      expect(f.facet, f.id).toBeUndefined();
    }
  });
});
