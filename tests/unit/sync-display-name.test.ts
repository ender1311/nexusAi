import { describe, expect, it } from "bun:test";
import { syncDisplayName, humanizeSlug } from "@/lib/hightouch/sync-display-name";
import type { HightouchSync } from "@/lib/hightouch/types";

function makeSync(over: Partial<HightouchSync>): HightouchSync {
  return {
    id: "1", name: null, slug: "some-slug", status: "success", primaryKey: "id",
    modelId: "m", destinationId: "d", schedule: null, lastRunAt: null,
    createdAt: "", updatedAt: "", configuration: {}, ...over,
  };
}

describe("syncDisplayName", () => {
  it("returns the override when one exists for the sync id", () => {
    const sync = makeSync({ id: "2770929", name: "raw-name", slug: "raw-slug" });
    expect(syncDisplayName(sync, { "2770929": "Push Opens" })).toBe("Push Opens");
  });

  it("falls back to trimmed sync.name when no override", () => {
    const sync = makeSync({ id: "1", name: "  Daily Givers  ", slug: "daily-givers" });
    expect(syncDisplayName(sync, {})).toBe("Daily Givers");
  });

  it("falls back to humanized slug when no override and no name", () => {
    const sync = makeSync({ id: "1", name: null, slug: "all-givers-to-nexus" });
    expect(syncDisplayName(sync, {})).toBe("All Givers To Nexus");
  });

  it("upper-cases known abbreviations in the humanized slug", () => {
    expect(humanizeSlug("lapsed-wau-yv")).toBe("Lapsed WAU YV");
  });
});
