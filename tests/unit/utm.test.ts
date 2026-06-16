import { describe, expect, it } from "bun:test";
import { withNexusUtm } from "@/lib/utm";

describe("withNexusUtm", () => {
  it("adds utm_campaign=nexus and utm_source=<channel> to a web URL", () => {
    expect(withNexusUtm("https://www.bible.com/today", "push")).toBe(
      "https://www.bible.com/today?utm_campaign=nexus&utm_source=push",
    );
  });

  it("uses the given channel as utm_source", () => {
    expect(withNexusUtm("https://www.bible.com/x", "content-card")).toContain("utm_source=content-card");
    expect(withNexusUtm("https://www.bible.com/x", "in-app")).toContain("utm_source=in-app");
  });

  it("preserves existing query params", () => {
    const out = withNexusUtm("https://www.bible.com/bible/1/JHN.1?audio=true", "push");
    expect(out).toContain("audio=true");
    expect(out).toContain("utm_campaign=nexus");
    expect(out).toContain("utm_source=push");
  });

  it("preserves an upstream utm_content (giving handle) and overwrites legacy campaign/source", () => {
    const out = withNexusUtm(
      "https://www.bible.com/give?amount=25&utm_content=25handle&utm_campaign=Nexus&utm_source=Nexus",
      "push",
    );
    expect(out).toContain("utm_content=25handle"); // preserved
    expect(out).toContain("utm_campaign=nexus");
    expect(out).not.toContain("utm_campaign=Nexus");
    expect(out).toContain("utm_source=push");
    expect(out).not.toContain("utm_source=Nexus");
    expect(out).toContain("amount=25");
  });

  it("is idempotent for the same channel", () => {
    const once = withNexusUtm("https://www.bible.com/today", "push");
    expect(withNexusUtm(once, "push")).toBe(once);
  });

  it("leaves app-scheme deeplinks unchanged (would break verse refs)", () => {
    expect(withNexusUtm("youversion://bible?reference=JHN.3.16", "push")).toBe(
      "youversion://bible?reference=JHN.3.16",
    );
    expect(withNexusUtm("youversion://bible", "push")).toBe("youversion://bible");
  });

  it("passes through null/undefined/empty unchanged", () => {
    expect(withNexusUtm(null, "push")).toBeNull();
    expect(withNexusUtm(undefined, "push")).toBeUndefined();
    expect(withNexusUtm("", "push")).toBe("");
  });

  it("returns unparseable input unchanged", () => {
    expect(withNexusUtm("not a url", "push")).toBe("not a url");
  });
});
