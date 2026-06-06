import { describe, it, expect } from "bun:test";
import { isGenericVotdLink, warnVerseOverride } from "@/lib/deeplinks/content-mismatch";

describe("content-mismatch warning", () => {
  it("flags bible.com VOTD as generic", () => {
    expect(isGenericVotdLink("https://www.bible.com/verse-of-the-day")).toBe(true);
    expect(isGenericVotdLink("youversion://votd")).toBe(true);
  });
  it("does not flag a specific verse reader link", () => {
    expect(isGenericVotdLink("https://www.bible.com/bible/111/ISA.41.10")).toBe(false);
  });
  it("warns only when the agent quotes verses AND the override is generic VOTD", () => {
    expect(warnVerseOverride({ hasVerseVariants: true, override: "https://www.bible.com/verse-of-the-day" })).toBe(true);
    expect(warnVerseOverride({ hasVerseVariants: false, override: "https://www.bible.com/verse-of-the-day" })).toBe(false);
    expect(warnVerseOverride({ hasVerseVariants: true, override: "https://www.bible.com/reading-plans" })).toBe(false);
    expect(warnVerseOverride({ hasVerseVariants: true, override: null })).toBe(false);
    expect(warnVerseOverride({ hasVerseVariants: true, override: "" })).toBe(false);
  });
});
