import { describe, it, expect } from "bun:test";
import { shapeVersePool, type CampaignContentRow } from "@/lib/cron/verse-pool";

function row(p: Partial<CampaignContentRow>): CampaignContentRow {
  return { contentType: "", language: "en", usfmReference: "JHN.3.16", usfmHuman: null, title: null, body: null, ...p };
}

const renderable = (usfm: string): CampaignContentRow[] => [
  row({ contentType: "verse-text", usfmReference: usfm, body: "text" }),
  row({ contentType: "a-title", usfmReference: usfm, title: "A" }),
  row({ contentType: "b-title", usfmReference: usfm, title: "B" }),
];

describe("shapeVersePool image rows", () => {
  it("attaches image_id from a contentType:image row to entry.imageId", () => {
    const pool = shapeVersePool([
      ...renderable("JHN.3.16"),
      row({ contentType: "image", usfmReference: "JHN.3.16", body: "77058" }),
    ]);
    expect(pool).toHaveLength(1);
    expect(pool[0].imageId).toBe("77058");
  });

  it("leaves imageId undefined when no image row exists", () => {
    const pool = shapeVersePool(renderable("JHN.3.16"));
    expect(pool[0].imageId).toBeUndefined();
  });

  it("does NOT make an image-only entry poolable (still needs renderable copy)", () => {
    const pool = shapeVersePool([
      row({ contentType: "image", usfmReference: "GEN.1.1", body: "999" }),
    ]);
    expect(pool).toHaveLength(0);
  });
});
