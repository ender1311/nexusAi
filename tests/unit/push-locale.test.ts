import { describe, it, expect } from "bun:test";
import { resolvePushLocale, resolvePushLocaleStrict, normalizePushLocaleTag } from "@/lib/push-locale";

const en = { title: "Build your Bible habit!", body: "take a moment in God's Word today." };
const es = { title: "Construye tu hábito", body: "tómate un momento hoy." };
const ptBR = { title: "Crie seu hábito", body: "reserve um momento hoje." };
const zhTW = { title: "建立習慣", body: "今天花點時間。" };
const zhCN = { title: "建立习惯", body: "今天花点时间。" };

function map(entries: Record<string, { title: string | null; body: string }>) {
  return new Map(Object.entries(entries));
}

describe("normalizePushLocaleTag", () => {
  it("lowercases primary, uppercases region", () => {
    expect(normalizePushLocaleTag("ES")).toEqual({ full: "es", primary: "es" });
    expect(normalizePushLocaleTag("es-es")).toEqual({ full: "es_ES", primary: "es" });
    expect(normalizePushLocaleTag("pt_BR")).toEqual({ full: "pt_BR", primary: "pt" });
  });
  it("canonicalizes Chinese scripts", () => {
    expect(normalizePushLocaleTag("zh_tw")).toEqual({ full: "zh_TW", primary: "zh" });
    expect(normalizePushLocaleTag("zh-CN")).toEqual({ full: "zh_CN", primary: "zh" });
    expect(normalizePushLocaleTag("zh_hk")).toEqual({ full: "zh_HK", primary: "zh" });
  });
  it("returns null for blank/garbage", () => {
    expect(normalizePushLocaleTag("")).toBeNull();
    expect(normalizePushLocaleTag("   ")).toBeNull();
  });
});

describe("resolvePushLocale", () => {
  it("exact full-tag match wins", () => {
    expect(resolvePushLocale("pt_BR", map({ pt_BR: ptBR, pt: { title: "x", body: "y" } }), en)).toEqual(ptBR);
  });
  it("base-subtag match when no exact", () => {
    expect(resolvePushLocale("es_ES", map({ es }), en)).toEqual(es);
    expect(resolvePushLocale("es", map({ es }), en)).toEqual(es);
  });
  it("keeps zh scripts distinct", () => {
    expect(resolvePushLocale("zh_TW", map({ zh_TW: zhTW, zh_CN: zhCN }), en)).toEqual(zhTW);
    expect(resolvePushLocale("zh_CN", map({ zh_TW: zhTW, zh_CN: zhCN }), en)).toEqual(zhCN);
  });
  it("bare zh with no exact row falls through to English (never picks a script)", () => {
    expect(resolvePushLocale("zh", map({ zh_TW: zhTW, zh_CN: zhCN }), en)).toEqual(en);
  });
  it("English fallback when language missing or absent", () => {
    expect(resolvePushLocale("fr", map({ es }), en)).toEqual(en);
    expect(resolvePushLocale(null, map({ es }), en)).toEqual(en);
    expect(resolvePushLocale(undefined, map({ es }), en)).toEqual(en);
    expect(resolvePushLocale("  ", map({ es }), en)).toEqual(en);
  });
  it("English recipients get English (no en row stored)", () => {
    expect(resolvePushLocale("en_US", map({ es }), en)).toEqual(en);
  });
});

describe("resolvePushLocaleStrict", () => {
  it("exact and base-subtag matches resolve like the lenient resolver", () => {
    expect(resolvePushLocaleStrict("pt_BR", map({ pt_BR: ptBR }), en)).toEqual(ptBR);
    expect(resolvePushLocaleStrict("es_ES", map({ es }), en)).toEqual(es);
    expect(resolvePushLocaleStrict("es", map({ es }), en)).toEqual(es);
  });
  it("keeps zh scripts distinct", () => {
    expect(resolvePushLocaleStrict("zh_TW", map({ zh_TW: zhTW, zh_CN: zhCN }), en)).toEqual(zhTW);
  });
  it("English recipients always get English copy", () => {
    expect(resolvePushLocaleStrict("en", map({ es }), en)).toEqual(en);
    expect(resolvePushLocaleStrict("en_US", map({ es }), en)).toEqual(en);
  });
  it("non-English recipient with no translation is skipped (null)", () => {
    expect(resolvePushLocaleStrict("fr", map({ es }), en)).toBeNull();
    expect(resolvePushLocaleStrict("zh", map({ zh_TW: zhTW }), en)).toBeNull();
  });
  it("unknown/blank language is skipped (null)", () => {
    expect(resolvePushLocaleStrict(null, map({ es }), en)).toBeNull();
    expect(resolvePushLocaleStrict(undefined, map({ es }), en)).toBeNull();
    expect(resolvePushLocaleStrict("  ", map({ es }), en)).toBeNull();
  });
});
