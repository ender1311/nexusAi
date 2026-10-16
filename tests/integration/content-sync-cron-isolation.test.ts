import { afterAll, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { NextRequest } from "next/server";

// One source's sync throwing must not stop the cron from syncing the others.
const realConfig = await import("@/connectors/content/config");
mock.module("@/connectors/content/config", () => ({
  ...realConfig,
  getContentSourceConfig: async () => ({ enabled: ["nexus-library", "contentful", "sanity"] }),
}));
const synced: string[] = [];
mock.module("@/connectors/content/sync", () => ({
  syncContentSource: async (id: string) => {
    synced.push(id);
    if (id === "contentful") throw new Error("connection terminated: secret detail");
    return { status: "ok", created: 1, updated: 0, archived: 0, skipped: 0, propagated: 0, errors: [] };
  },
}));
const cronRoute = await import("@/app/api/cron/content-sync/route");

describe("GET /api/cron/content-sync: per-source isolation", () => {
  const saved = process.env.CRON_SECRET;
  let consoleError: ReturnType<typeof spyOn>;
  beforeAll(() => { process.env.CRON_SECRET = "cron-s"; consoleError = spyOn(console, "error").mockImplementation(() => {}); });
  afterAll(() => {
    if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
    consoleError.mockRestore();
  });

  it("records a crashed source as failed and still syncs the next one", async () => {
    const res = await cronRoute.GET(new NextRequest("http://t", { headers: { authorization: "Bearer cron-s" } }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(synced).toEqual(["contentful", "sanity"]);
    expect(data.results.contentful).toEqual({ status: "failed", created: 0, updated: 0, archived: 0, skipped: 0, propagated: 0,
      errors: [{ externalRef: "(cron)", message: "Sync crashed" }] });
    expect(data.results.sanity.status).toBe("ok");
    expect(JSON.stringify(data)).not.toContain("secret detail");
  });
});
