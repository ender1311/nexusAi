import { describe, it, expect } from "bun:test";
import {
  buildVerseUrl,
  parseVerseText,
  fetchVerseText,
  LANGUAGE_VERSION_MAP,
} from "@/lib/youversion/verse-api";

describe("buildVerseUrl", () => {
  it("builds the verses.json URL with literal references[] and encoded USFM", () => {
    expect(buildVerseUrl("JHN.3.16", 111)).toBe(
      "https://bible.youversionapi.com/3.1/verses.json?references[]=JHN.3.16&id=111&format=text",
    );
  });
  it("percent-encodes the + in a verse range", () => {
    expect(buildVerseUrl("JHN.3.16+JHN.3.17", 149)).toBe(
      "https://bible.youversionapi.com/3.1/verses.json?references[]=JHN.3.16%2BJHN.3.17&id=149&format=text",
    );
  });
});

describe("parseVerseText", () => {
  it("returns the single verse content trimmed", () => {
    const json = { response: { data: { verses: [{ content: "  For God so loved  " }] } } };
    expect(parseVerseText(json)).toBe("For God so loved");
  });
  it("joins a multi-verse range with a single space", () => {
    const json = { response: { data: { verses: [{ content: "first." }, { content: "second." }] } } };
    expect(parseVerseText(json)).toBe("first. second.");
  });
  it("returns null when verses is empty or missing", () => {
    expect(parseVerseText({ response: { data: { verses: [] } } })).toBeNull();
    expect(parseVerseText({ response: { data: {} } })).toBeNull();
    expect(parseVerseText({})).toBeNull();
    expect(parseVerseText(null)).toBeNull();
  });
  it("returns null when content is blank or non-string", () => {
    expect(parseVerseText({ response: { data: { verses: [{ content: "   " }] } } })).toBeNull();
    expect(parseVerseText({ response: { data: { verses: [{ content: 42 }] } } })).toBeNull();
  });
});

describe("fetchVerseText", () => {
  const okJson = (text: string) =>
    Promise.resolve(new Response(JSON.stringify({ response: { data: { verses: [{ content: text }] } } }), { status: 200 }));

  it("returns parsed text on a 200 response", async () => {
    const stub = (() => okJson("Jesus wept.")) as unknown as typeof fetch;
    expect(await fetchVerseText("JHN.11.35", 111, stub)).toBe("Jesus wept.");
  });
  it("returns null on a non-OK response", async () => {
    const stub = (() => Promise.resolve(new Response("nope", { status: 404 }))) as unknown as typeof fetch;
    expect(await fetchVerseText("JHN.11.35", 111, stub)).toBeNull();
  });
  it("returns null when the fetch throws (timeout/network)", async () => {
    const stub = (() => Promise.reject(new Error("timeout"))) as unknown as typeof fetch;
    expect(await fetchVerseText("JHN.11.35", 111, stub)).toBeNull();
  });
});

describe("LANGUAGE_VERSION_MAP", () => {
  it("maps known languages to their default version ids", () => {
    expect(LANGUAGE_VERSION_MAP.en).toBe(111);
    expect(LANGUAGE_VERSION_MAP.es).toBe(149);
    expect(LANGUAGE_VERSION_MAP.pt).toBe(211);
    expect(LANGUAGE_VERSION_MAP.zh_CN).toBe(48);
    expect(LANGUAGE_VERSION_MAP.zh_TW).toBe(46);
  });
  it("uses underscore region forms, not hyphens", () => {
    expect(LANGUAGE_VERSION_MAP["zh-CN"]).toBeUndefined();
    expect(LANGUAGE_VERSION_MAP.pt_PT).toBe(228);
  });
});
