import { describe, expect, it } from "bun:test";
import { constantTimeEqual } from "../../src/lib/constant-time-compare";

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("secret-token", "secret-token")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(constantTimeEqual("secret-token", "secret-tokeX")).toBe(false);
  });

  it("returns false for strings of different length without throwing", () => {
    // Plain timingSafeEqual throws on length mismatch; the SHA-256 hashing in
    // constantTimeEqual equalizes length so this must simply return false.
    expect(constantTimeEqual("short", "a-much-longer-token-value")).toBe(false);
  });

  it("returns false when one side is empty", () => {
    expect(constantTimeEqual("", "non-empty")).toBe(false);
    expect(constantTimeEqual("non-empty", "")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
