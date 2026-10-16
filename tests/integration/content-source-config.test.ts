import { beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import { getContentSourceConfig, saveContentSourceConfig } from "@/connectors/content/config";

describe("content source config", () => {
  beforeEach(truncateAll);

  it("defaults to nexus-library only when nothing is stored", async () => {
    const c = await getContentSourceConfig();
    expect(c.enabled).toEqual(["nexus-library"]);
    expect(c.contentful).toBeUndefined();
  });

  it("round-trips a full config and never stores secrets", async () => {
    await saveContentSourceConfig({
      enabled: ["nexus-library", "contentful", "braze-catalog"],
      contentful: { spaceId: "sp1", environment: "master", contentType: "pushMessage", channel: "push", mapping: {} },
      brazeCatalog: { catalogName: "lumen_tips", channel: "content_card", mapping: { title: "headline" } },
    });
    const c = await getContentSourceConfig();
    expect(c.enabled).toContain("contentful");
    expect(c.brazeCatalog?.catalogName).toBe("lumen_tips");
    const raw = await prisma.appSetting.findUnique({ where: { key: "content_source_config" } });
    expect(raw?.value).not.toMatch(/token|secret/i);
  });

  it("falls back to the default when the stored JSON is invalid", async () => {
    await prisma.appSetting.create({ data: { key: "content_source_config", value: "{not json" } });
    expect((await getContentSourceConfig()).enabled).toEqual(["nexus-library"]);
  });
});
