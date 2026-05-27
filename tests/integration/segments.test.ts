import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { createUserSegment } from "../helpers/builders";
import { GET } from "@/app/api/segments/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/segments", () => {
  it("returns empty list when no segments exist", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it("returns distinct segment names sorted alphabetically", async () => {
    await createUserSegment("user1", "zebra_segment");
    await createUserSegment("user2", "alpha_segment");
    await createUserSegment("user3", "alpha_segment"); // duplicate — should dedupe
    await createUserSegment("user4", "mid_segment");

    const res = await GET();
    const body = await res.json();
    expect(body.data).toEqual(["alpha_segment", "mid_segment", "zebra_segment"]);
  });
});
