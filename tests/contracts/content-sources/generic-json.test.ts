import { describe, expect, it } from "bun:test";
import { FakeFetch } from "../../helpers/braze";
import { createContentSource } from "@/connectors/content/registry";
import c1 from "../../fixtures/content/generic/cursor-1.json";
import c2 from "../../fixtures/content/generic/cursor-2.json";

const base = { url: "https://cms.example.com/api/messages", itemsPath: "data.items", channel: "push" as const, mapping: { externalRef: "id", body: "text", title: "headline" } };

describe("generic-json adapter", () => {
  it("follows a cursor and uses the custom mapping", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(c1);
    ff.queueResponse(c2);
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "cursor" as const, nextPath: "next", param: "after" } } };
    const src = createContentSource("generic-json", config, { GENERIC_CONTENT_TOKEN: "g" } as unknown as NodeJS.ProcessEnv, ff.fetch as typeof fetch);
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
    const p = await createContentSource("generic-json", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch).listItems();
    expect(p.next).toBeUndefined();
    expect(ff.requests[0]!.url).toBe("https://cms.example.com/api/messages?page=1");
  });

  it("reports a non-array itemsPath as an error, not a crash", async () => {
    const ff = new FakeFetch();
    ff.queueResponse({ data: { items: "nope" } });
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "none" as const } } };
    await expect(createContentSource("generic-json", config, {} as NodeJS.ProcessEnv, ff.fetch as typeof fetch).listItems()).rejects.toThrow(/itemsPath/);
  });
});
