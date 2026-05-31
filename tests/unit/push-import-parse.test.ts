import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { parseFilename, parseFileContents } from "@/lib/push-import/parse";

function fixture(name: string) {
  return readFileSync(new URL(`../fixtures/push-import/${name}`, import.meta.url), "utf8");
}

describe("parseFilename", () => {
  it("splits stem and lang on the last hyphen (preserves hyphens in stem)", () => {
    expect(parseFilename("2026-01-daily-remind-PUSH-1-en.json")).toEqual({
      stem: "2026-01-daily-remind-PUSH-1", language: "en",
    });
  });
  it("keeps underscore lang codes intact", () => {
    expect(parseFilename("2026-01-daily-remind-PUSH-1-zh_TW.json")).toEqual({
      stem: "2026-01-daily-remind-PUSH-1", language: "zh_TW",
    });
  });
  it("canonicalizes lang casing (es-ES style not expected in filenames, but lowercase regions normalized)", () => {
    expect(parseFilename("foo-bar-pt_br.json")).toEqual({ stem: "foo-bar", language: "pt_BR" });
  });
  it("handles .yml extension", () => {
    expect(parseFilename("resurrection-verse-PUSH-1-fr.yml")).toEqual({
      stem: "resurrection-verse-PUSH-1", language: "fr",
    });
  });
  it("returns null for unsupported extension or no lang suffix", () => {
    expect(parseFilename("schedule.md")).toBeNull();
    expect(parseFilename("combined/liquid_title.html")).toBeNull();
    expect(parseFilename("nohyphen.json")).toBeNull();
  });
  it("returns null when the trailing token is not a language code", () => {
    expect(parseFilename("2026-01-reward-remind-PUSH-1.json")).toBeNull();
  });
});

describe("parseFileContents", () => {
  it("maps JSON keys to copy", () => {
    expect(parseFileContents(fixture("2026-01-daily-remind-PUSH-1-es.json"), "json")).toEqual({
      title: "¡Crea tu hábito bíblico!",
      body: "tómate un momento para pasar tiempo en la Palabra de Dios hoy.",
      bodyPersonal: "${NAME}, tómate un momento para pasar tiempo en la Palabra de Dios hoy.",
    });
  });
  it("falls back to personal body when non_personal is absent", () => {
    const copy = parseFileContents(JSON.stringify({ push_title: "T", push_message_personal: "${NAME} hi" }), "json");
    expect(copy).toEqual({ title: "T", body: "${NAME} hi", bodyPersonal: "${NAME} hi" });
  });
  it("parses YAML", () => {
    expect(parseFileContents(fixture("resurrection-verse-PUSH-1-fr.yml"), "yml")).toEqual({
      title: "Il est ressuscité",
      body: "Célébrez la résurrection aujourd'hui.",
      bodyPersonal: null,
    });
  });
  it("returns null when no usable body", () => {
    expect(parseFileContents(JSON.stringify({ push_title: "only title" }), "json")).toBeNull();
    expect(parseFileContents("not json", "json")).toBeNull();
  });
});
