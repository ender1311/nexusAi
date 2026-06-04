import { describe, it, expect } from "bun:test";
import {
  VERSE_IMAGE_SENTINEL,
  DEFAULT_VERSE_IMAGE_ID,
  buildVerseImageUrl,
  buildVerseImageUrls,
  assetFileTypeFromUrl,
} from "@/lib/verse-image";

describe("verse-image", () => {
  it("sentinel + default id are stable constants", () => {
    expect(VERSE_IMAGE_SENTINEL).toBe("__NEXUS_VERSE_IMAGE__");
    expect(DEFAULT_VERSE_IMAGE_ID).toBe("1012");
  });

  it("buildVerseImageUrl composes the imageproxy URL with WxH and image_id", () => {
    expect(buildVerseImageUrl("77058", 320, 320)).toBe(
      "https://imageproxy-cdn.youversionapi.com/320x320/https://s3.amazonaws.com/static-youversionapi-com/images/base/77058/1280x1280.jpg"
    );
  });

  it("buildVerseImageUrls returns 320x320 iOS and 1024x512 Android", () => {
    const { ios, android } = buildVerseImageUrls("56520");
    expect(ios).toBe(buildVerseImageUrl("56520", 320, 320));
    expect(android).toBe(buildVerseImageUrl("56520", 1024, 512));
  });

  it("assetFileTypeFromUrl reads the extension, defaulting to jpg", () => {
    expect(assetFileTypeFromUrl("https://x/y/1280x1280.jpg")).toBe("jpg");
    expect(assetFileTypeFromUrl("https://x/y/a.PNG")).toBe("png");
    expect(assetFileTypeFromUrl("https://x/y/a.gif?w=1")).toBe("gif");
    expect(assetFileTypeFromUrl("https://x/y/noext")).toBe("jpg");
  });
});
