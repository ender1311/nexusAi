import { describe, it, expect } from "bun:test";
import { shapeVersePool, type CampaignContentRow } from "@/lib/cron/verse-pool";

const rows: CampaignContentRow[] = [
  { contentType: "verse-text", language: "en", usfmReference: "JHN.3.16", usfmHuman: "John 3:16", title: null, body: "For God..." },
  { contentType: "a-title",    language: "en", usfmReference: "JHN.3.16", usfmHuman: "John 3:16", title: "Clickbait", body: null },
  { contentType: "b-title",    language: "en", usfmReference: "JHN.3.16", usfmHuman: "John 3:16", title: "Reflect", body: null },
  { contentType: "reference",  language: "es", usfmReference: "JHN.3.16", usfmHuman: "John 3:16", title: null, body: "Juan 3:16" },
  { contentType: "verse-text", language: "es", usfmReference: "JHN.3.16", usfmHuman: "John 3:16", title: null, body: "Porque..." },
  { contentType: "verse-text", language: "en", usfmReference: "ISA.1.1", usfmHuman: "Isaiah 1:1", title: null, body: "Vision..." },
];

describe("shapeVersePool", () => {
  const pool = shapeVersePool(rows);

  it("includes only refs whose EN entry can render every arm", () => {
    expect(pool.map((e) => e.usfm)).toEqual(["JHN.3.16"]);
  });
  it("derives EN reference from usfmHuman when no reference row exists", () => {
    expect(pool[0].byLang.get("en")!.reference).toBe("John 3:16");
  });
  it("keeps localized fields (es reference + verse-text)", () => {
    const es = pool[0].byLang.get("es")!;
    expect(es.reference).toBe("Juan 3:16");
    expect(es["verse-text"]).toBe("Porque...");
  });
  it("maps a-title/b-title from the title column", () => {
    const en = pool[0].byLang.get("en")!;
    expect(en["a-title"]).toBe("Clickbait");
    expect(en["b-title"]).toBe("Reflect");
  });
});
