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

describe("applyFieldMapping", () => {
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
