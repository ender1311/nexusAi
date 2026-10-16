import { describe, expect, it } from "bun:test";
import { FakeFetch } from "../../helpers/braze";
import { createContentSource } from "@/connectors/content/registry";
import page1 from "../../fixtures/content/contentful/page-1.json";
import page2 from "../../fixtures/content/contentful/page-2.json";

const config = { enabled: ["contentful" as const], contentful: { spaceId: "sp1", environment: "master", contentType: "pushMessage", channel: "push" as const, mapping: {} } };
const env = { CONTENTFUL_DELIVERY_TOKEN: "cf-token" } as unknown as NodeJS.ProcessEnv;

describe("contentful adapter", () => {
  it("pages to the end, maps locales, skips malformed items with their id, sends the token", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(page1);
    ff.queueResponse(page2);
    const src = createContentSource("contentful", config, env, ff.fetch as typeof fetch);
    const p1 = await src.listItems();
    expect(p1.items.map((i) => i.externalRef)).toEqual(["e1"]);
    expect(p1.skipped).toEqual([{ externalRef: "e2", error: expect.stringContaining("body") }]);
    expect(p1.items[0]!.locales?.es?.body).toBeDefined();
    expect(p1.next).toBe("2");
    const p2 = await src.listItems(p1.next);
    expect(p2.items.map((i) => i.externalRef)).toEqual(["e3"]);
    expect(p2.next).toBeUndefined();
    expect(ff.requests[0]!.url).toContain("/spaces/sp1/environments/master/entries?content_type=pushMessage&locale=*&order=sys.createdAt&skip=0&limit=100");
    expect(ff.requests[0]!.headers.authorization).toBe("Bearer cf-token");
  });

  it("testConnection reports an auth failure without throwing", async () => {
    const ff = new FakeFetch();
    ff.queueResponse({ message: "The access token you sent could not be found or is invalid." }, 401);
    const r = await createContentSource("contentful", config, env, ff.fetch as typeof fetch).testConnection();
    expect(r).toEqual({ ok: false, error: "Contentful responded 401" });
  });

  it("rejects a non-numeric cursor", async () => {
    const ff = new FakeFetch();
    await expect(createContentSource("contentful", config, env, ff.fetch as typeof fetch).listItems("abc")).rejects.toThrow("Invalid cursor");
  });

  it("reports a non-JSON 200 body clearly", async () => {
    const src = createContentSource("contentful", config, env, (async () => new Response("<html>")) as unknown as typeof fetch);
    await expect(src.listItems()).rejects.toThrow("Contentful returned a non-JSON response");
  });

  it("throws ContentSourceNotConfigured without a token", () => {
    expect(() => createContentSource("contentful", config, {} as NodeJS.ProcessEnv)).toThrow(/CONTENTFUL_DELIVERY_TOKEN/);
  });
});
