import { describe, expect, it } from "bun:test";
import { FakeFetch } from "../../helpers/braze";
import { contentSourceConfigSchema } from "@/connectors/content/config";
import { createContentSource } from "@/connectors/content/registry";
import p1 from "../../fixtures/content/sanity/page-1.json";
import p2 from "../../fixtures/content/sanity/page-2.json";

const config = { enabled: ["sanity" as const], sanity: { projectId: "abc123", dataset: "production", query: '*[_type == "tip"]', channel: "content_card" as const, mapping: {} } };

describe("sanity adapter", () => {
  it("slices with GROQ until an empty page, skips malformed docs", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(p1);
    ff.queueResponse(p2);
    const src = createContentSource("sanity", config, { SANITY_READ_TOKEN: "s-tok" } as unknown as NodeJS.ProcessEnv, ff.fetch as typeof fetch);
    const a = await src.listItems();
    expect(a.items).toHaveLength(2);
    expect(a.skipped).toHaveLength(1);
    expect(a.next).toBeUndefined(); // 3 docs < page size: no extra empty request
    expect(ff.requests).toHaveLength(1);
    const url = decodeURIComponent(ff.requests[0]!.url);
    expect(url).toContain("https://abc123.api.sanity.io/v2025-02-19/data/query/production?query=");
    expect(url).toContain('*[_type == "tip"][0...100]');
    expect(ff.requests[0]!.headers.authorization).toBe("Bearer s-tok");
  });

  it("continues while pages are full, stops on a short page", async () => {
    const doc = (i: number) => ({ _id: `d${i}`, _updatedAt: "2026-09-01T00:00:00Z", title: "t", body: "b" });
    const ff = new FakeFetch();
    ff.queueResponse({ result: Array.from({ length: 100 }, (_, i) => doc(i)) });
    ff.queueResponse({ result: [doc(100)] });
    const src = createContentSource("sanity", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch);
    const a = await src.listItems();
    expect(a.next).toBe("100");
    const b = await src.listItems(a.next);
    expect(b.next).toBeUndefined();
    expect(decodeURIComponent(ff.requests[1]!.url)).toContain("[100...200]");
  });

  it("rejects a non-numeric cursor and a non-JSON body", async () => {
    const ff = new FakeFetch();
    await expect(createContentSource("sanity", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch).listItems("x")).rejects.toThrow("Invalid cursor");
    const bad = createContentSource("sanity", config, {} as NodeJS.ProcessEnv, (async () => new Response("nope")) as unknown as typeof fetch);
    await expect(bad.listItems()).rejects.toThrow("Sanity returned a non-JSON response");
  });

  it("works without a token for public datasets", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(p2);
    await createContentSource("sanity", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch).listItems();
    expect(ff.requests[0]!.headers.authorization).toBeUndefined();
  });
});

describe("sanity config schema", () => {
  it("rejects a projectId that could redirect the request host", () => {
    const bad = { ...config, sanity: { ...config.sanity, projectId: "evil.com/x#" } };
    expect(contentSourceConfigSchema.safeParse(bad).success).toBe(false);
    const badDataset = { ...config, sanity: { ...config.sanity, dataset: "a/b" } };
    expect(contentSourceConfigSchema.safeParse(badDataset).success).toBe(false);
  });
});
