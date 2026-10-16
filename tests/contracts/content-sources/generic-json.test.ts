import { describe, expect, it } from "bun:test";
import { FakeFetch } from "../../helpers/braze";
import { createContentSource } from "@/connectors/content/registry";
import { assertPublicHttpsUrl } from "@/connectors/content/http";
import { contentSourceConfigSchema } from "@/connectors/content/config";
import c1 from "../../fixtures/content/generic/cursor-1.json";
import c2 from "../../fixtures/content/generic/cursor-2.json";

const publicLookup = async () => [{ address: "93.184.216.34" }];
const base = { url: "https://cms.example.com/api/messages", itemsPath: "data.items", channel: "push" as const, mapping: { externalRef: "id", body: "text", title: "headline" } };

describe("generic-json adapter", () => {
  it("follows a cursor and uses the custom mapping", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(c1);
    ff.queueResponse(c2);
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "cursor" as const, nextPath: "next", param: "after" } } };
    const src = createContentSource("generic-json", config, { GENERIC_CONTENT_TOKEN: "g" } as unknown as NodeJS.ProcessEnv, ff.fetch as typeof fetch, publicLookup);
    const a = await src.listItems();
    expect(a.items).toHaveLength(2);
    expect(a.next).toBe("abc");
    const b = await src.listItems(a.next);
    expect(b.next).toBeUndefined();
    expect(ff.requests[1]!.url).toBe("https://cms.example.com/api/messages?after=abc");
  });

  it("page mode stops when a page is shorter than pageSize", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(c2);
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "page" as const, param: "page", pageSize: 50 } } };
    const p = await createContentSource("generic-json", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch, publicLookup).listItems();
    expect(p.next).toBeUndefined();
    expect(ff.requests[0]!.url).toBe("https://cms.example.com/api/messages?page=1");
  });

  it("reports a non-array itemsPath as an error, not a crash", async () => {
    const ff = new FakeFetch();
    ff.queueResponse({ data: { items: "nope" } });
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "none" as const } } };
    await expect(createContentSource("generic-json", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch, publicLookup).listItems()).rejects.toThrow(/itemsPath/);
  });

  it("stops when the server repeats the cursor it was given", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(c1); // next: "abc"
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "cursor" as const, nextPath: "next", param: "after" } } };
    const p = await createContentSource("generic-json", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch, publicLookup).listItems("abc");
    expect(p.next).toBeUndefined();
  });

  it("page mode stops on an empty page even when pageSize is tiny", async () => {
    const ff = new FakeFetch();
    ff.queueResponse({ data: { items: [] } });
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "page" as const, param: "page", pageSize: 1 } } };
    const p = await createContentSource("generic-json", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch, publicLookup).listItems("7");
    expect(p.items).toHaveLength(0);
    expect(p.next).toBeUndefined();
  });

  it("does not follow redirects", async () => {
    const ff = new FakeFetch();
    ff.queueResponse({}, 302);
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "none" as const } } };
    await expect(createContentSource("generic-json", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch, publicLookup).listItems()).rejects.toThrow(/redirect/);
    expect(ff.requests[0]!.url).toBe("https://cms.example.com/api/messages");
  });

  it("refuses a URL whose host resolves to a private address, before any request", async () => {
    const ff = new FakeFetch();
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "none" as const } } };
    const src = createContentSource("generic-json", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch, async () => [{ address: "10.0.0.5" }]);
    await expect(src.listItems()).rejects.toThrow("Content URL must be public https");
    expect(ff.requests).toHaveLength(0);
  });

  it("config requires an https url", () => {
    const bad = { enabled: ["generic-json" as const], genericJson: { ...base, url: "http://cms.example.com/x", pagination: { mode: "none" as const } } };
    expect(contentSourceConfigSchema.safeParse(bad).success).toBe(false);
  });
});

describe("assertPublicHttpsUrl", () => {
  const pub = async () => [{ address: "93.184.216.34" }];
  it.each([
    "http://cms.example.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest",
    "https://10.0.0.5/x", "https://172.20.1.1/x", "https://192.168.1.1/x", "https://0.0.0.0/x",
    "https://[::1]/x", "https://[fe80::1]/x", "https://[fd00::1]/x", "https://[::ffff:127.0.0.1]/x", "https://100.64.0.1/x", "https://100.100.100.200/x",
    "https://198.18.0.1/x", "https://192.0.0.1/x", "https://192.0.2.1/x", "https://224.0.0.1/x", "https://255.255.255.255/x",
    "https://[::ffff:a00:5]/x", "https://[::7f00:1]/x", "https://[64:ff9b::a00:5]/x", "https://[::ffff:0:a00:5]/x", "not a url",
  ])("rejects %s", async (url) => {
    await expect(assertPublicHttpsUrl(url, pub)).rejects.toThrow("Content URL must be public https");
  });
  it("rejects a hostname that resolves to a private address (injected lookup)", async () => {
    await expect(assertPublicHttpsUrl("https://cms.example.com/x", async () => [{ address: "93.184.216.34" }, { address: "10.0.0.5" }])).rejects.toThrow("Content URL must be public https");
    await expect(assertPublicHttpsUrl("https://cms.example.com/x", async () => { throw new Error("ENOTFOUND"); })).rejects.toThrow("Content URL must be public https");
  });
  it("accepts a public https host", async () => {
    await expect(assertPublicHttpsUrl("https://cms.example.com/x", pub)).resolves.toBeUndefined();
    await expect(assertPublicHttpsUrl("https://8.8.8.8/x", pub)).resolves.toBeUndefined();
  });
});
