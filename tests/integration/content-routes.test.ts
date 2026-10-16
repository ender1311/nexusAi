import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { prisma } from "../helpers/db";

let isAdmin = true;
mock.module("@/lib/auth", () => ({
  requireAdmin: async () => (isAdmin ? null : NextResponse.json({ error: "Forbidden" }, { status: 403 })),
}));

const settings = await import("@/app/api/settings/content-sources/route");
const testRoute = await import("@/app/api/content/test/[source]/route");
const syncRoute = await import("@/app/api/content/sync/[source]/route");
const runsRoute = await import("@/app/api/content/sync-runs/route");
const webhookRoute = await import("@/app/api/content/webhook/[source]/route");
const cronRoute = await import("@/app/api/cron/content-sync/route");

const SECRET_ENV = ["CONTENTFUL_DELIVERY_TOKEN", "SANITY_READ_TOKEN", "GENERIC_CONTENT_TOKEN", "BRAZE_API_KEY", "CONTENT_WEBHOOK_SECRET", "CRON_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

const contentfulConfig = {
  enabled: ["nexus-library", "contentful"],
  contentful: { spaceId: "sp1", environment: "master", contentType: "pushCopy", channel: "push", mapping: { body: "body" } },
};

const params = (source: string) => ({ params: Promise.resolve({ source }) });
const json = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });

beforeEach(async () => {
  isAdmin = true;
  for (const k of SECRET_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  await prisma.contentSyncRun.deleteMany();
  await prisma.appSetting.deleteMany({ where: { key: "content_source_config" } });
});
afterEach(async () => {
  for (const k of SECRET_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await prisma.contentSyncRun.deleteMany();
  await prisma.appSetting.deleteMany({ where: { key: "content_source_config" } });
});

describe("GET/PUT /api/settings/content-sources", () => {
  it("returns the default config and token presence, never token values", async () => {
    process.env.CONTENTFUL_DELIVERY_TOKEN = "tok-super-secret-123";
    const res = await settings.GET();
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("tok-super-secret-123");
    const body = JSON.parse(text);
    expect(body.data.config).toEqual({ enabled: ["nexus-library"] });
    expect(body.data.tokens).toEqual({ contentful: true, sanity: false, genericJson: false, braze: false });
  });

  it("saves a valid config and a later GET returns it", async () => {
    const put = await settings.PUT(json("http://t", "PUT", contentfulConfig));
    expect(put.status).toBe(200);
    const get = await (await settings.GET()).json();
    expect(get.data.config.enabled).toEqual(["nexus-library", "contentful"]);
    expect(get.data.config.contentful.spaceId).toBe("sp1");
  });

  it("rejects empty enabled and unknown sources with 400", async () => {
    expect((await settings.PUT(json("http://t", "PUT", { enabled: [] }))).status).toBe(400);
    expect((await settings.PUT(json("http://t", "PUT", { enabled: ["nope"] }))).status).toBe(400);
  });

  it("is admin-only", async () => {
    isAdmin = false;
    expect((await settings.GET()).status).toBe(403);
    expect((await settings.PUT(json("http://t", "PUT", contentfulConfig))).status).toBe(403);
  });
});

describe("POST /api/content/test/[source]", () => {
  it("reports a missing token as ok:false without calling the network", async () => {
    await settings.PUT(json("http://t", "PUT", contentfulConfig));
    const res = await testRoute.POST(json("http://t", "POST"), params("contentful"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: false, error: "CONTENTFUL_DELIVERY_TOKEN is not set" } });
  });
  it("404s an unknown source and 403s non-admins", async () => {
    expect((await testRoute.POST(json("http://t", "POST"), params("nope"))).status).toBe(404);
    isAdmin = false;
    expect((await testRoute.POST(json("http://t", "POST"), params("contentful"))).status).toBe(403);
  });
});

describe("POST /api/content/sync/[source]", () => {
  it("404s an unknown source", async () => {
    expect((await syncRoute.POST(json("http://t", "POST"), params("nope"))).status).toBe(404);
  });
  it("skips a source that is not enabled", async () => {
    const res = await syncRoute.POST(json("http://t", "POST"), params("sanity"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("skipped");
    expect(body.data.reason).toBe("not-enabled");
  });
  it("is admin-only", async () => {
    isAdmin = false;
    expect((await syncRoute.POST(json("http://t", "POST"), params("sanity"))).status).toBe(403);
  });
});

describe("GET /api/content/sync-runs", () => {
  it("returns the latest 10 newest first, filterable by source", async () => {
    for (let i = 0; i < 12; i++) {
      await prisma.contentSyncRun.create({
        data: { source: i % 2 === 0 ? "sanity" : "contentful", status: "ok", startedAt: new Date(Date.UTC(2026, 0, 1, 0, i)), finishedAt: new Date(Date.UTC(2026, 0, 1, 0, i, 5)) },
      });
    }
    const all = await (await runsRoute.GET(json("http://t/api/content/sync-runs", "GET"))).json();
    expect(all.data).toHaveLength(10);
    const times = all.data.map((r: { startedAt: string }) => new Date(r.startedAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const only = await (await runsRoute.GET(json("http://t/api/content/sync-runs?source=sanity", "GET"))).json();
    expect(only.data).toHaveLength(6);
    expect(only.data.every((r: { source: string }) => r.source === "sanity")).toBe(true);
  });
  it("400s an unknown source filter and 403s non-admins", async () => {
    expect((await runsRoute.GET(json("http://t/api/content/sync-runs?source=nope", "GET"))).status).toBe(400);
    isAdmin = false;
    expect((await runsRoute.GET(json("http://t/api/content/sync-runs", "GET"))).status).toBe(403);
  });
});

describe("POST /api/content/webhook/[source]", () => {
  const raw = '{"sys":{"id":"e1"}}';
  const sign = (secret: string) => createHmac("sha256", secret).update(raw).digest("hex");
  const hook = (source: string, headers: Record<string, string> = {}) =>
    webhookRoute.POST(new NextRequest("http://t", { method: "POST", body: raw, headers }), params(source));

  it("401s a missing or bad signature", async () => {
    process.env.CONTENT_WEBHOOK_SECRET = "whsec";
    expect((await hook("contentful")).status).toBe(401);
    expect((await hook("contentful", { "x-nexus-signature": sign("wrong") })).status).toBe(401);
  });
  it("401s when no secret is configured, even with a signature", async () => {
    expect((await hook("contentful", { "x-nexus-signature": sign("whsec") })).status).toBe(401);
  });
  it("404s an unknown source", async () => {
    process.env.CONTENT_WEBHOOK_SECRET = "whsec";
    expect((await hook("nope", { "x-nexus-signature": sign("whsec") })).status).toBe(404);
  });
  it("202s a valid signature (any accepted header) and runs the sync", async () => {
    process.env.CONTENT_WEBHOOK_SECRET = "whsec";
    await settings.PUT(json("http://t", "PUT", contentfulConfig));
    for (const header of ["x-nexus-signature", "x-contentful-signature", "sanity-webhook-signature"]) {
      await prisma.contentSyncRun.deleteMany();
      const res = await hook("contentful", { [header]: sign("whsec") });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ data: { queued: true } });
      // No token in env: the sync records a failed run, never touching the network.
      expect(await prisma.contentSyncRun.count({ where: { source: "contentful" } })).toBe(1);
    }
  });
});

describe("GET /api/cron/content-sync", () => {
  const cron = (auth?: string) =>
    cronRoute.GET(new NextRequest("http://t", { method: "GET", headers: auth ? { authorization: auth } : {} }));

  it("401s without the bearer token, or when CRON_SECRET is unset", async () => {
    expect((await cron()).status).toBe(401);
    expect((await cron("Bearer anything")).status).toBe(401);
    process.env.CRON_SECRET = "cron-s";
    expect((await cron("Bearer wrong")).status).toBe(401);
  });
  it("syncs each enabled non-library source", async () => {
    process.env.CRON_SECRET = "cron-s";
    await settings.PUT(json("http://t", "PUT", contentfulConfig));
    const res = await cron("Bearer cron-s");
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Object.keys(data.results)).toEqual(["contentful"]);
    expect(data.results.contentful.status).toBe("failed");
  });
});
