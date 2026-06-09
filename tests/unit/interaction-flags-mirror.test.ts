// Regression: apps/api/src/lib/interaction-flags.ts mirrors
// src/lib/constants/interaction-flags.ts because apps/api cannot import from src/.
// This test asserts the two lists are identical so they cannot silently drift.
import { describe, expect, it } from "bun:test";
import { INTERACTION_FLAGS as CANONICAL } from "@/lib/constants/interaction-flags";
import { INTERACTION_FLAGS as MIRROR } from "../../apps/api/src/lib/interaction-flags";

describe("interaction-flags mirror drift guard", () => {
  it("apps/api mirror equals the canonical INTERACTION_FLAGS list", () => {
    expect([...MIRROR]).toEqual([...CANONICAL]);
  });
});
