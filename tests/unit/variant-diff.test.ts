import { describe, expect, it } from "bun:test";
import { detectTestedVariables } from "@/lib/engine/variant-diff";
import type { MessageVariant } from "@/types/agent";

function v(overrides: Partial<MessageVariant> = {}): MessageVariant {
  return {
    id: "v1", messageId: "m1", name: "A", body: "body",
    status: "active", createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("detectTestedVariables", () => {
  it("returns empty array for single variant", () => {
    expect(detectTestedVariables([v()])).toEqual([]);
  });

  it("returns empty for zero variants", () => {
    expect(detectTestedVariables([])).toEqual([]);
  });

  it("returns empty when all variants are identical", () => {
    expect(detectTestedVariables([v({ title: "X" }), v({ title: "X" })])).toEqual([]);
  });

  it("detects differing title", () => {
    const result = detectTestedVariables([v({ title: "A" }), v({ title: "B" })]);
    expect(result).toContain("title");
  });

  it("detects differing body", () => {
    const result = detectTestedVariables([v({ body: "Hello" }), v({ body: "World" })]);
    expect(result).toContain("body");
  });

  it("detects differing deeplink", () => {
    const result = detectTestedVariables([v({ deeplink: "/a" }), v({ deeplink: "/b" })]);
    expect(result).toContain("deeplink");
  });

  it("detects differing preferredHour (sendHour)", () => {
    const result = detectTestedVariables([v({ preferredHour: 9 }), v({ preferredHour: 14 })]);
    expect(result).toContain("sendHour");
  });

  it("detects differing preferredDayOfWeek (sendDayOfWeek)", () => {
    const result = detectTestedVariables([v({ preferredDayOfWeek: 1 }), v({ preferredDayOfWeek: 5 })]);
    expect(result).toContain("sendDayOfWeek");
  });

  it("detects multiple differing fields", () => {
    const result = detectTestedVariables([
      v({ title: "A", body: "Hello" }),
      v({ title: "B", body: "World" }),
    ]);
    expect(result).toContain("title");
    expect(result).toContain("body");
  });

  it("does not include fields that are the same", () => {
    const result = detectTestedVariables([
      v({ title: "Same", body: "Hello" }),
      v({ title: "Same", body: "World" }),
    ]);
    expect(result).not.toContain("title");
    expect(result).toContain("body");
  });
});
