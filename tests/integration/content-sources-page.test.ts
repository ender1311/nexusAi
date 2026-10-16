import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextResponse } from "next/server";
import { prisma } from "../helpers/db";

mock.module("@/lib/auth", () => ({
  requireAdmin: async () => null as NextResponse | null,
}));

const settings = await import("@/app/api/settings/content-sources/route");
const runsRoute = await import("@/app/api/content/sync-runs/route");
const { loadContentSourcesPageData } = await import("@/connectors/content/page-data");

const TOKEN_ENV = ["CONTENTFUL_DELIVERY_TOKEN", "SANITY_READ_TOKEN", "GENERIC_CONTENT_TOKEN", "BRAZE_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

async function clean() {
  await prisma.contentSyncRun.deleteMany();
  await prisma.appSetting.deleteMany({ where: { key: "content_source_config" } });
}

beforeEach(async () => {
  for (const k of TOKEN_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  await clean();
});
afterEach(async () => {
  for (const k of TOKEN_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await clean();
});

describe("/settings/content-sources page data", () => {
  it("matches GET /api/settings/content-sources (config plus token booleans)", async () => {
    process.env.SANITY_READ_TOKEN = "tok-secret";
    await prisma.appSetting.create({
      data: {
        key: "content_source_config",
        value: JSON.stringify({
          enabled: ["nexus-library", "contentful"],
          contentful: { spaceId: "sp1", environment: "master", contentType: "tip", channel: "push", mapping: {} },
        }),
      },
    });
    const api = (await (await settings.GET()).json()) as { data: { config: unknown; tokens: unknown } };
    const page = await loadContentSourcesPageData();
    expect(page.config).toEqual(api.data.config as typeof page.config);
    expect(page.tokens).toEqual(api.data.tokens as typeof page.tokens);
    expect(page.tokens).toEqual({ contentful: false, sanity: true, genericJson: false, braze: false });
  });

  it("returns the default config on a fresh database", async () => {
    const page = await loadContentSourcesPageData();
    expect(page.config).toEqual({ enabled: ["nexus-library"] });
    expect(page.runs).toEqual([]);
  });

  it("shows at most 10 runs, newest first, and matches GET /api/content/sync-runs", async () => {
    for (let i = 0; i < 12; i++) {
      await prisma.contentSyncRun.create({
        data: {
          source: "contentful", status: i === 11 ? "failed" : "ok", created: i,
          startedAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
          errors: i === 11 ? [{ externalRef: "e1", message: "boom" }] : [],
        },
      });
    }
    const page = await loadContentSourcesPageData();
    expect(page.runs).toHaveLength(10);
    expect(page.runs[0].created).toBe(11);
    expect(page.runs[0].firstError).toBe("boom");
    expect(page.runs[1].firstError).toBeNull();

    const api = (await (await runsRoute.GET(new Request("http://localhost/api/content/sync-runs"))).json()) as { data: { id: string }[] };
    expect(api.data).toHaveLength(10);
    expect(page.runs.map((r) => r.id)).toEqual(api.data.map((r) => r.id));
  });
});
