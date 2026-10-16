import { describe, expect, it } from "bun:test";
import { buildSaveBody, defaultMappingFor, initialFormState } from "@/lib/content-sources-form";
import { contentSourceConfigSchema } from "@/connectors/content/config";

describe("content sources form state", () => {
  it("round-trips a saved generic-json config through the save body", () => {
    const config = contentSourceConfigSchema.parse({
      enabled: ["nexus-library", "generic-json"],
      genericJson: {
        url: "https://example.com/feed.json", itemsPath: "items", channel: "push",
        pagination: { mode: "page", param: "p", pageSize: 25 }, mapping: { body: "text" },
      },
    });
    const body = buildSaveBody(initialFormState(config), config);
    expect(contentSourceConfigSchema.parse(body)).toEqual(config);
  });

  it("drops empty mapping inputs and omits blocks for untouched disabled sources", () => {
    const config = contentSourceConfigSchema.parse({ enabled: ["nexus-library"] });
    const state = initialFormState(config);
    state.contentful.mapping = { body: "  ", title: "fields.headline" };
    state.enabled.contentful = true;
    state.contentful = { ...state.contentful, spaceId: "sp1", contentType: "tip" };
    const body = buildSaveBody(state, config);
    expect(body.sanity).toBeUndefined();
    expect(body.contentful).toEqual({ spaceId: "sp1", environment: "master", contentType: "tip", channel: "push", mapping: { title: "fields.headline" } });
    expect(body.enabled).toEqual(["nexus-library", "contentful"]);
  });

  it("keeps a saved block when its source is switched off", () => {
    const config = contentSourceConfigSchema.parse({
      enabled: ["nexus-library", "braze-catalog"], brazeCatalog: { catalogName: "tips", channel: "push", mapping: {} },
    });
    const state = initialFormState(config);
    state.enabled["braze-catalog"] = false;
    const body = buildSaveBody(state, config);
    expect(body.enabled).toEqual(["nexus-library"]);
    expect(body.brazeCatalog).toBeDefined();
  });

  it("exposes the adapter default as the mapping placeholder", () => {
    expect(defaultMappingFor("contentful", "externalRef")).toBe("sys.id");
    expect(defaultMappingFor("braze-catalog", "htmlBody")).toBe("");
  });
});
