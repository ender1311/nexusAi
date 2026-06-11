// tests/unit/votd-version-map.test.ts
import { describe, it, expect } from "bun:test";
import { VERSION_MAP, DEFAULT_VERSION_ID, contentLanguageFor, versionForLanguage } from "@/lib/votd/version-map";

describe("contentLanguageFor", () => {
  it("resolves a full regional tag present in the map", () => {
    expect(contentLanguageFor("en-GB")).toBe("en_GB");
    expect(contentLanguageFor("zh-tw")).toBe("zh_TW");
  });
  it("falls back to the primary subtag when the full tag is unmapped", () => {
    expect(contentLanguageFor("es-ES")).toBe("es");
    expect(contentLanguageFor("pt-BR")).toBe("pt");
  });
  it("falls back to en for unknown, blank, and null tags", () => {
    expect(contentLanguageFor("zz")).toBe("en");
    expect(contentLanguageFor("")).toBe("en");
    expect(contentLanguageFor(null)).toBe("en");
    expect(contentLanguageFor(undefined)).toBe("en");
    expect(contentLanguageFor("zh")).toBe("en"); // bare zh is not in the map
  });
});

describe("versionForLanguage", () => {
  it("returns the mapped version id", () => {
    expect(versionForLanguage("es")).toBe(149);
    expect(versionForLanguage("zh_CN")).toBe(48);
    expect(versionForLanguage("en")).toBe(111);
  });
  it("defaults to NIV (111) for unmapped tags", () => {
    expect(versionForLanguage("zz")).toBe(DEFAULT_VERSION_ID);
    expect(DEFAULT_VERSION_ID).toBe(111);
  });
  it("map has ~70 entries", () => {
    expect(Object.keys(VERSION_MAP).length).toBeGreaterThanOrEqual(68);
  });
});
