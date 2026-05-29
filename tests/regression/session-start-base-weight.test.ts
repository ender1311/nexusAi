import { describe, expect, it } from "bun:test";
import { YOUVERSION_GOALS } from "@/lib/constants/youversion";

// Regression: session_start preset base weight should be 3 (was 10).
// The agent wizard seeds a new goal's valueWeight from preset.weight,
// so this constant is the source of the default session_start weight.
describe("session_start base weight", () => {
  it("defaults the session_start preset weight to 3", () => {
    const sessionStart = YOUVERSION_GOALS.find((g) => g.eventName === "session_start");
    expect(sessionStart?.weight).toBe(3);
  });
});
