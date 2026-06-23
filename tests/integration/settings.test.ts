import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";

import { GET, POST } from "@/app/api/settings/route";

function rawRequest(body: string): Request {
  return new Request("http://localhost/", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("POST /api/settings", () => {
  it("upserts settings from a valid object and returns 200", async () => {
    const req = buildRequest("POST", { brazeApiKey: "abc123", brazeRestEndpoint: "https://rest.example.com" });
    const res = await POST(req as NextRequest);

    expect(res.status).toBe(200);
    const stored = await prisma.appSetting.findMany();
    const map = Object.fromEntries(stored.map((s) => [s.key, s.value]));
    expect(map.brazeApiKey).toBe("abc123");
    expect(map.brazeRestEndpoint).toBe("https://rest.example.com");
  });

  it("coerces non-string values to strings on upsert", async () => {
    const req = buildRequest("POST", { suppressThresh: 0.42, enabled: true });
    const res = await POST(req as NextRequest);

    expect(res.status).toBe(200);
    const stored = await prisma.appSetting.findMany();
    const map = Object.fromEntries(stored.map((s) => [s.key, s.value]));
    expect(map.suppressThresh).toBe("0.42");
    expect(map.enabled).toBe("true");
  });

  it("overwrites an existing setting (upsert update path)", async () => {
    await prisma.appSetting.create({ data: { key: "brazeApiKey", value: "old" } });

    const req = buildRequest("POST", { brazeApiKey: "new" });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const rows = await prisma.appSetting.findMany({ where: { key: "brazeApiKey" } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.value).toBe("new");
  });

  it("round-trips push_targeting_mode through POST then GET", async () => {
    const postRes = await POST(buildRequest("POST", { push_targeting_mode: "strict" }) as NextRequest);
    expect(postRes.status).toBe(200);

    const getRes = await GET();
    const body = await getRes.json();
    expect(body.push_targeting_mode).toBe("strict");

    // overwrite to permissive
    await POST(buildRequest("POST", { push_targeting_mode: "permissive" }) as NextRequest);
    const getRes2 = await GET();
    const body2 = await getRes2.json();
    expect(body2.push_targeting_mode).toBe("permissive");
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await POST(rawRequest("{not valid json") as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("returns 400 when body is not a plain object (array)", async () => {
    const req = buildRequest("POST", ["a", "b"]);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when body is a primitive", async () => {
    const res = await POST(rawRequest("42") as NextRequest);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/settings", () => {
  // Security: GET returns ONLY the client-readable allowlist, never the whole
  // AppSetting table — so a secret accidentally stored there can't leak to any
  // authenticated staff session.
  it("returns only allowlisted client-readable keys", async () => {
    await prisma.appSetting.create({ data: { key: "push_targeting_mode", value: "strict" } });
    await prisma.appSetting.create({ data: { key: "baseline_push_open_rate", value: "0.1" } });
    await prisma.appSetting.create({ data: { key: "k1", value: "v1" } });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ push_targeting_mode: "strict", baseline_push_open_rate: "0.1" });
  });

  it("never leaks a non-allowlisted (secret-looking) key", async () => {
    await prisma.appSetting.create({ data: { key: "brazeApiKey", value: "super-secret" } });
    await prisma.appSetting.create({ data: { key: "global_sending_paused", value: "true" } });

    const res = await GET();
    const body = await res.json();
    expect(body.brazeApiKey).toBeUndefined();
    // global_sending_paused is read server-side (kill switch prop), not via GET.
    expect(body.global_sending_paused).toBeUndefined();
  });
});
