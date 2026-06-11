// tests/unit/votd-tags.test.ts
import { describe, it, expect } from "bun:test";
import { hasVotdTags, substituteVotdTags, type VotdSubstitutions } from "@/lib/votd/votd-tags";

const subs: VotdSubstitutions = {
  guidedScriptureLabel: "Today's Guided Scripture",
  guidedPrayerLabel: "Today's Guided Prayer",
  votdReference: "John 3:16",
  votdText: "For God so loved the world",
};

describe("hasVotdTags", () => {
  it("detects each tag in title or body", () => {
    expect(hasVotdTags("{{guided_scripture_label}}", "x")).toBe(true);
    expect(hasVotdTags("x", "{{guided_prayer_label}}")).toBe(true);
    expect(hasVotdTags(null, "{{votd_reference}}")).toBe(true);
    expect(hasVotdTags("{{votd_text}}", null)).toBe(true);
  });
  it("returns false for plain copy and null/undefined", () => {
    expect(hasVotdTags("Hello", "World")).toBe(false);
    expect(hasVotdTags(null, null)).toBe(false);
  });
});

describe("substituteVotdTags", () => {
  it("substitutes all four tags", () => {
    expect(substituteVotdTags("{{guided_scripture_label}}: {{votd_reference}}", subs))
      .toBe("Today's Guided Scripture: John 3:16");
    expect(substituteVotdTags("{{guided_prayer_label}} — {{votd_text}}", subs))
      .toBe("Today's Guided Prayer — For God so loved the world");
  });
  it("substitutes multiple occurrences", () => {
    expect(substituteVotdTags("{{votd_reference}} {{votd_reference}}", subs)).toBe("John 3:16 John 3:16");
  });
  it("leaves text without tags unchanged", () => {
    expect(substituteVotdTags("plain", subs)).toBe("plain");
  });
});
