import { describe, expect, it } from "bun:test";
import {
  GENERIC_BIBLE_DEEPLINK,
  SPECIFIC_VERSE_DEEPLINK_PREFIX,
  buildSpecificVerseDeeplink,
  parseUsfmFromDeeplink,
  isSpecificVerseDeeplink,
  resolveSpecificVerseDeeplink,
} from "@/lib/push-deeplinks";

describe("buildSpecificVerseDeeplink", () => {
  it("single verse: MAT.1.1", () => {
    expect(buildSpecificVerseDeeplink("MAT.1.1")).toBe(
      "youversion://bible?reference=MAT.1.1"
    );
  });

  it("multi-verse same chapter: MAT.1.1+MAT.1.2", () => {
    expect(buildSpecificVerseDeeplink("MAT.1.1+MAT.1.2")).toBe(
      "youversion://bible?reference=MAT.1.1+MAT.1.2"
    );
  });

  it("range notation: JHN.1.1-15", () => {
    expect(buildSpecificVerseDeeplink("JHN.1.1-15")).toBe(
      "youversion://bible?reference=JHN.1.1-15"
    );
  });

  it("cross-chapter complex: ISA.43.18+ISA.43.19", () => {
    expect(buildSpecificVerseDeeplink("ISA.43.18+ISA.43.19")).toBe(
      "youversion://bible?reference=ISA.43.18+ISA.43.19"
    );
  });
});

describe("parseUsfmFromDeeplink", () => {
  it("specific verse deeplink: returns USFM", () => {
    expect(parseUsfmFromDeeplink("youversion://bible?reference=MAT.1.1")).toBe(
      "MAT.1.1"
    );
  });

  it("multi-verse deeplink: returns full USFM", () => {
    expect(
      parseUsfmFromDeeplink("youversion://bible?reference=ISA.43.18+ISA.43.19")
    ).toBe("ISA.43.18+ISA.43.19");
  });

  it("generic deeplink: returns null", () => {
    expect(parseUsfmFromDeeplink("youversion://bible")).toBeNull();
  });

  it("null input: returns null", () => {
    expect(parseUsfmFromDeeplink(null)).toBeNull();
  });

  it("undefined input: returns null", () => {
    expect(parseUsfmFromDeeplink(undefined)).toBeNull();
  });

  it("empty string: returns null", () => {
    expect(parseUsfmFromDeeplink("")).toBeNull();
  });

  it("partial prefix without reference: returns null", () => {
    expect(parseUsfmFromDeeplink("youversion://bible?reference=")).toBeNull();
  });

  it("wrong prefix: returns null", () => {
    expect(parseUsfmFromDeeplink("youversion://something?reference=MAT.1.1")).toBeNull();
  });

  it("non-string input: returns null", () => {
    expect(parseUsfmFromDeeplink(123 as unknown as string)).toBeNull();
  });
});

describe("isSpecificVerseDeeplink", () => {
  it("valid specific verse deeplink: returns true", () => {
    expect(isSpecificVerseDeeplink("youversion://bible?reference=MAT.1.1")).toBe(
      true
    );
  });

  it("multi-verse deeplink: returns true", () => {
    expect(
      isSpecificVerseDeeplink("youversion://bible?reference=MAT.1.1+MAT.1.2")
    ).toBe(true);
  });

  it("generic deeplink: returns false", () => {
    expect(isSpecificVerseDeeplink("youversion://bible")).toBe(false);
  });

  it("null input: returns false", () => {
    expect(isSpecificVerseDeeplink(null)).toBe(false);
  });

  it("undefined input: returns false", () => {
    expect(isSpecificVerseDeeplink(undefined)).toBe(false);
  });

  it("empty string: returns false", () => {
    expect(isSpecificVerseDeeplink("")).toBe(false);
  });

  it("partial prefix without reference: returns false", () => {
    expect(isSpecificVerseDeeplink("youversion://bible?reference=")).toBe(false);
  });

  it("wrong prefix: returns false", () => {
    expect(
      isSpecificVerseDeeplink("youversion://something?reference=MAT.1.1")
    ).toBe(false);
  });
});

describe("resolveSpecificVerseDeeplink", () => {
  it("generic mode always returns generic deeplink", () => {
    expect(
      resolveSpecificVerseDeeplink(
        "youversion://bible?reference=MAT.1.1",
        "generic"
      )
    ).toBe(GENERIC_BIBLE_DEEPLINK);
  });

  it("specific mode with stored deeplink: returns stored", () => {
    expect(
      resolveSpecificVerseDeeplink(
        "youversion://bible?reference=JHN.1.1",
        "specific"
      )
    ).toBe("youversion://bible?reference=JHN.1.1");
  });

  it("specific mode with null stored deeplink: returns generic", () => {
    expect(resolveSpecificVerseDeeplink(null, "specific")).toBe(
      GENERIC_BIBLE_DEEPLINK
    );
  });

  it("specific mode with undefined stored deeplink: returns generic", () => {
    expect(resolveSpecificVerseDeeplink(undefined, "specific")).toBe(
      GENERIC_BIBLE_DEEPLINK
    );
  });

  it("generic mode with null: returns generic", () => {
    expect(resolveSpecificVerseDeeplink(null, "generic")).toBe(
      GENERIC_BIBLE_DEEPLINK
    );
  });

  it("generic mode with empty string: returns generic", () => {
    expect(resolveSpecificVerseDeeplink("", "generic")).toBe(
      GENERIC_BIBLE_DEEPLINK
    );
  });
});

describe("Constants", () => {
  it("GENERIC_BIBLE_DEEPLINK value", () => {
    expect(GENERIC_BIBLE_DEEPLINK).toBe("youversion://bible");
  });

  it("SPECIFIC_VERSE_DEEPLINK_PREFIX value", () => {
    expect(SPECIFIC_VERSE_DEEPLINK_PREFIX).toBe(
      "youversion://bible?reference="
    );
  });
});
