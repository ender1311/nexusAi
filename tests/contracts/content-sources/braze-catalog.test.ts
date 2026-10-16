import { describe, expect, it } from "bun:test";
import { createContentSource } from "@/connectors/content/registry";
import { ContentSourceNotConfigured } from "@/connectors/content/types";
import p1 from "../../fixtures/content/braze-catalog/page-1.json";
import p2 from "../../fixtures/content/braze-catalog/page-2.json";

const config = { enabled: ["braze-catalog" as const], brazeCatalog: { catalogName: "lumen_tips", channel: "content_card" as const, mapping: {} } };
const env = { BRAZE_API_KEY: "bk", BRAZE_REST_ENDPOINT: "https://rest.iad-01.braze.com" } as unknown as NodeJS.ProcessEnv;

describe("braze-catalog adapter", () => {
  it("follows the Link header and is reference-mode", async () => {
    const calls: { url: string; auth: string | undefined }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: (init?.headers as Record<string, string>).Authorization });
      const first = calls.length === 1;
      return new Response(JSON.stringify(first ? p1 : p2), {
        status: 200,
        headers: first ? { Link: '<https://rest.iad-01.braze.com/catalogs/lumen_tips/items?cursor=c2>; rel="next"' } : {},
      });
    }) as typeof fetch;
    const src = createContentSource("braze-catalog", config, env, fakeFetch);
    expect(src.activation).toBe("reference");
    const a = await src.listItems();
    expect(a.items).toHaveLength(2);
    expect(a.next).toBe("https://rest.iad-01.braze.com/catalogs/lumen_tips/items?cursor=c2");
    const b = await src.listItems(a.next);
    expect(b.items).toHaveLength(1);
    expect(b.next).toBeUndefined();
    expect(calls[0]!.url).toBe("https://rest.iad-01.braze.com/catalogs/lumen_tips/items");
    expect(calls[0]!.auth).toBe("Bearer bk");
  });

  it("refuses a cursor URL on a different host", async () => {
    const src = createContentSource("braze-catalog", config, env, (async () => new Response("{}")) as unknown as typeof fetch);
    await expect(src.listItems("https://evil.example.com/x")).rejects.toThrow(/cursor/);
  });

  const respond = (link: string | null) => (async () => new Response(JSON.stringify(p2), { status: 200, headers: link ? { Link: link } : {} })) as unknown as typeof fetch;

  it("stops when the Link header points back at the page just fetched", async () => {
    const url = "https://rest.iad-01.braze.com/catalogs/lumen_tips/items?cursor=c2";
    const src = createContentSource("braze-catalog", config, env, respond(`<${url}>; rel="next"`));
    expect((await src.listItems(url)).next).toBeUndefined();
  });

  it("resolves a relative Link URL against the REST origin", async () => {
    const src = createContentSource("braze-catalog", config, env, respond('</catalogs/lumen_tips/items?cursor=c9>; rel="next"'));
    expect((await src.listItems()).next).toBe("https://rest.iad-01.braze.com/catalogs/lumen_tips/items?cursor=c9");
  });

  it("an invalid BRAZE_REST_ENDPOINT is ContentSourceNotConfigured, not a TypeError", () => {
    const bad = { BRAZE_API_KEY: "bk", BRAZE_REST_ENDPOINT: "not a url" } as unknown as NodeJS.ProcessEnv;
    expect(() => createContentSource("braze-catalog", config, bad)).toThrow(ContentSourceNotConfigured);
  });

  it("reports a non-JSON 200 body clearly", async () => {
    const src = createContentSource("braze-catalog", config, env, (async () => new Response("<html>")) as unknown as typeof fetch);
    await expect(src.listItems()).rejects.toThrow("Braze catalogs returned a non-JSON response");
  });
});
