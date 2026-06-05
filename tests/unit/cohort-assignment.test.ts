import { describe, it, expect } from "bun:test";
import { selectCohort } from "@/lib/cron/cohort-assignment";

// Deterministic RNG that returns 0 → Fisher-Yates is a no-op (stable order).
const noShuffle = () => 0;

describe("selectCohort", () => {
  it("returns all eligible users when pool is smaller than the cap", () => {
    expect(selectCohort(["a", "b", "c"], 10, noShuffle).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns exactly N when pool exceeds the cap", () => {
    const picked = selectCohort(["a", "b", "c", "d", "e"], 3, noShuffle);
    expect(picked).toHaveLength(3);
    for (const id of picked) expect(["a", "b", "c", "d", "e"]).toContain(id);
  });

  it("returns an empty array when the pool is empty", () => {
    expect(selectCohort([], 100, noShuffle)).toEqual([]);
  });

  it("returns an empty array when cap is zero or negative", () => {
    expect(selectCohort(["a", "b"], 0, noShuffle)).toEqual([]);
    expect(selectCohort(["a", "b"], -1, noShuffle)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const pool = ["a", "b", "c"];
    selectCohort(pool, 2, Math.random);
    expect(pool).toEqual(["a", "b", "c"]);
  });
});
