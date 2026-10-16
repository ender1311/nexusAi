import { describe, expect, it } from "bun:test";
import { FakeFetch } from "../../helpers/braze";
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
    expect(a.next).toBe("100");
    const b = await src.listItems(a.next);
    expect(b.items).toHaveLength(0);
    expect(b.next).toBeUndefined();
    const url = decodeURIComponent(ff.requests[0]!.url);
    expect(url).toContain("https://abc123.api.sanity.io/v2025-02-19/data/query/production?query=");
    expect(url).toContain('*[_type == "tip"][0...100]');
    expect(ff.requests[0]!.headers.authorization).toBe("Bearer s-tok");
  });

  it("works without a token for public datasets", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(p2);
    await createContentSource("sanity", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch).listItems();
    expect(ff.requests[0]!.headers.authorization).toBeUndefined();
  });
});
