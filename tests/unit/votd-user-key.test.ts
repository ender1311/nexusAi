// tests/unit/votd-user-key.test.ts
import { describe, it, expect } from "bun:test";
import { resolveVotdUserKey, votdContentKey } from "@/lib/votd/votd-user-key";

const at = new Date("2026-06-11T15:00:00Z"); // 10:00 CDT — same calendar day in Chicago

describe("resolveVotdUserKey", () => {
  it("reads timezone + language_tag from an attributes object", () => {
    expect(resolveVotdUserKey({ timezone: "Asia/Tokyo", language_tag: "es" }, at))
      .toEqual({ date: "2026-06-12", languageTag: "es" }); // 00:00 Jun 12 JST
  });
  it("parses attributes passed as a JSON string", () => {
    expect(resolveVotdUserKey('{"timezone":"Asia/Tokyo","language_tag":"pt-BR"}', at))
      .toEqual({ date: "2026-06-12", languageTag: "pt" });
  });
  it("defaults to Chicago + en for null/garbage attributes", () => {
    expect(resolveVotdUserKey(null, at)).toEqual({ date: "2026-06-11", languageTag: "en" });
    expect(resolveVotdUserKey("not json", at)).toEqual({ date: "2026-06-11", languageTag: "en" });
    expect(resolveVotdUserKey([1, 2], at)).toEqual({ date: "2026-06-11", languageTag: "en" });
  });
});

describe("votdContentKey", () => {
  it("joins date and language with a space separator", () => {
    expect(votdContentKey("2026-06-11", "en")).toBe("2026-06-11 en");
  });
});
