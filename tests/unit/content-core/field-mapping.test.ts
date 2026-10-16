import { describe, expect, it } from "bun:test";
import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";

describe("getPath", () => {
  const o = { a: { b: [{ c: 1 }, { c: 2 }] }, t: [{ sys: { id: "x" } }, { sys: { id: "y" } }] };
  it("reads dot paths, indexes and [*] collections", () => {
    expect(getPath(o, "a.b[1].c")).toBe(2);
    expect(getPath(o, "t[*].sys.id")).toEqual(["x", "y"]);
    expect(getPath(o, "a.missing.deep")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
  });
});

describe("getPath hostile and edge inputs", () => {
  it("does not walk the prototype chain", () => {
    expect(getPath({}, "constructor.name")).toBeUndefined();
    expect(getPath({}, "constructor")).toBeUndefined();
  });
  it("reads from a root array", () => {
    expect(getPath([{ a: 5 }], "[0].a")).toBe(5);
  });
  it("caps [*] fan-out at 10,000 values", () => {
    const big = { xs: Array.from({ length: 20_000 }, (_, i) => ({ n: i })) };
    const out = getPath(big, "xs[*].n") as number[];
    expect(out.length).toBe(10_000);
  });
});

describe("applyFieldMapping", () => {
  it("does not pollute Object.prototype from a JSON-parsed __proto__ mapping or record", () => {
    const mapping = JSON.parse('{"externalRef":"id","body":"body","__proto__":"body"}');
    const record = JSON.parse('{"id":"p1","body":"ok","__proto__":{"x":1}}');
    const r = applyFieldMapping(record, mapping, { channel: "push" });
    expect("item" in r).toBe(true);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("does not split a non-locale object whose keys look like 2-letter codes", () => {
    const r = applyFieldMapping({ id: "a", body: { id: "real", to: "z" } }, { externalRef: "id", body: "body" }, { channel: "push" });
    expect("error" in r && r.error).toMatch(/a.*body/);
  });

  it("splits BCP-47 locale maps (fil, zh-Hans, es-419)", () => {
    const body = { "en-US": "Hi", fil: "Kumusta", "zh-Hans": "你好", "es-419": "Hola" };
    const r = applyFieldMapping({ id: "a", body }, { externalRef: "id", body: "body" }, { channel: "push" });
    if (!("item" in r)) throw new Error(r.error);
    expect(r.item.body).toBe("Hi");
    expect(r.item.locales?.fil?.body).toBe("Kumusta");
    expect(r.item.locales?.["zh-Hans"]?.body).toBe("你好");
    expect(r.item.locales?.["es-419"]?.body).toBe("Hola");
  });

  it("drops an optional field whose value is an object instead of coercing it", () => {
    const r = applyFieldMapping({ id: "a", body: "b", cta: { id: "1", to: "2" } }, { externalRef: "id", body: "body", cta: "cta" }, { channel: "push" });
    if (!("item" in r)) throw new Error(r.error);
    expect(r.item.cta).toBeUndefined();
  });

  it("rejects non-http(s) imageUrl but allows custom-scheme deeplinks", () => {
    const bad = applyFieldMapping({ id: "a", body: "b", img: "javascript:alert(1)" }, { externalRef: "id", body: "body", imageUrl: "img" }, { channel: "push" });
    expect("error" in bad).toBe(true);
    const ok = applyFieldMapping({ id: "a", body: "b", dl: "lumen://x", img: "https://e.com/a.png" }, { externalRef: "id", body: "body", deeplink: "dl", imageUrl: "img" }, { channel: "push" });
    expect("item" in ok).toBe(true);
  });

  it("truncates the ref in error strings to 200 chars", () => {
    const r = applyFieldMapping({ id: "x".repeat(500) }, { externalRef: "id", body: "body" }, { channel: "push" });
    expect("error" in r && r.error.startsWith("x".repeat(200) + ":")).toBe(true);
  });

  it("maps a Contentful-shaped entry with the default mapping", () => {
    const entry = {
      sys: { id: "e1", updatedAt: "2026-10-01T00:00:00Z" },
      fields: { title: { "en-US": "Breathe" }, body: { "en-US": "Two minutes.", "es": "Dos minutos." }, cta: { "en-US": "Start" } },
      metadata: { tags: [{ sys: { id: "calm" } }] },
    };
    const r = applyFieldMapping(entry, DEFAULT_MAPPINGS.contentful, { channel: "push" });
    if (!("item" in r)) throw new Error(r.error);
    expect(r.item).toMatchObject({ externalRef: "e1", channel: "push", title: "Breathe", body: "Two minutes.", cta: "Start", tags: ["calm"] });
    expect(r.item.locales?.es?.body).toBe("Dos minutos.");
  });

  it("errors with the externalRef when a required field is missing", () => {
    const r = applyFieldMapping({ id: "x9", headline: "Hi" }, { externalRef: "id", title: "headline", body: "text" }, { channel: "push" });
    expect("error" in r && r.error).toMatch(/x9.*body/);
  });

  it("coerces numbers to strings, trims, and drops empty optional fields", () => {
    const r = applyFieldMapping({ id: 42, body: "  Hello  ", cta: "" }, { externalRef: "id", body: "body", cta: "cta" }, { channel: "content_card" });
    if (!("item" in r)) throw new Error(r.error);
    expect(r.item.externalRef).toBe("42");
    expect(r.item.body).toBe("Hello");
    expect(r.item.cta).toBeUndefined();
  });

  it("rejects non-object records", () => {
    expect("error" in applyFieldMapping("str", DEFAULT_MAPPINGS["generic-json"], { channel: "push" })).toBe(true);
  });
});
