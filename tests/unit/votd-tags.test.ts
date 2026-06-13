// tests/unit/votd-tags.test.ts
import { describe, it, expect } from "bun:test";
import { hasVotdTags, hasGpTags, substituteVotdTags, substituteGpTags, type VotdSubstitutions, type GpSubstitutions } from "@/lib/votd/votd-tags";

const subs: VotdSubstitutions = {
  guidedScriptureLabel: "Today's Guided Scripture",
  guidedPrayerLabel: "Today's Guided Prayer",
  votdReference: "John 3:16",
  votdText: "For God so loved the world",
};

describe("hasVotdTags", () => {
  it("detects each tag in title or body", () => {
    expect(hasVotdTags("{{guided_scripture_label}}", "x")).toBe(true);
    expect(hasVotdTags(null, "{{votd_reference}}")).toBe(true);
    expect(hasVotdTags("{{votd_text}}", null)).toBe(true);
  });
  it("does NOT detect {{guided_prayer_label}} — GP label is not a VOTD signal", () => {
    // GP variants use {{gp_verse_ref}}/{{gp_verse_text}} as their content signals.
    // Routing on {{guided_prayer_label}} alone caused GP variants to pull VOTD content.
    expect(hasVotdTags("x", "{{guided_prayer_label}}")).toBe(false);
  });
  it("returns false for plain copy and null/undefined", () => {
    expect(hasVotdTags("Hello", "World")).toBe(false);
    expect(hasVotdTags(null, null)).toBe(false);
  });
});

describe("hasGpTags", () => {
  it("detects gp verse tags", () => {
    expect(hasGpTags("{{gp_verse_ref}}", "x")).toBe(true);
    expect(hasGpTags("x", "{{gp_verse_text}}")).toBe(true);
  });
  it("returns false for VOTD-only copy", () => {
    expect(hasGpTags("{{votd_text}}", "{{votd_reference}}")).toBe(false);
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
