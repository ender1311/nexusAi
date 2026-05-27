import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { POST } from "@/app/api/ingest/segments/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

// ── auth ───────────────────────────────────────────────────────────────────
describe("auth", () => {
  it("returns 401 without auth header", async () => {
    const req = buildRequest("POST", { users: [] });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });
});

// ── validation ─────────────────────────────────────────────────────────────
describe("validation", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/ingest/segments", {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json", ...AUTH },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when batch exceeds 1000 users", async () => {
    const users = Array.from({ length: 1001 }, (_, i) => ({
      external_user_id: `user_${i}`,
      attributes: { ht_segment_name: "big_segment" },
    }));
    const req = buildRequest("POST", { users }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("1000");
  });
});

// ── segment creation ────────────────────────────────────────────────────────
describe("segment creation", () => {
  it("creates UserSegment rows for valid users", async () => {
    const req = buildRequest(
      "POST",
      {
        users: [
          {
            external_user_id: "usr_seg_1",
            attributes: { ht_segment_name: "morning_readers" },
          },
          {
            external_user_id: "usr_seg_2",
            attributes: { ht_segment_name: "morning_readers" },
          },
        ],
      },
      AUTH,
    );
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const segments = await prisma.userSegment.findMany({
      where: { segmentName: "morning_readers" },
    });
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.externalId).sort()).toEqual(["usr_seg_1", "usr_seg_2"]);
  });

  it("is idempotent — sending same payload twice does not duplicate rows", async () => {
    const payload = {
      users: [
        {
          external_user_id: "usr_idem_1",
          attributes: { ht_segment_name: "daily_devotion" },
        },
      ],
    };
    const req1 = buildRequest("POST", payload, AUTH);
    await POST(req1 as NextRequest);
    const req2 = buildRequest("POST", payload, AUTH);
    await POST(req2 as NextRequest);

    const count = await prisma.userSegment.count({
      where: { externalId: "usr_idem_1", segmentName: "daily_devotion" },
    });
    expect(count).toBe(1);
  });

  it("skips users missing both external_user_id and braze_id", async () => {
    const req = buildRequest(
      "POST",
      {
        users: [
          { attributes: { ht_segment_name: "seg_a" } }, // no identity
          { external_user_id: "usr_valid", attributes: { ht_segment_name: "seg_a" } },
        ],
      },
      AUTH,
    );
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.skipped).toBe(1);
    expect(body.upserted).toBe(1);

    const count = await prisma.userSegment.count();
    expect(count).toBe(1);
  });

  it("creates TrackedUser if it did not exist before", async () => {
    const req = buildRequest(
      "POST",
      {
        users: [
          {
            external_user_id: "usr_new",
            attributes: { ht_segment_name: "new_segment" },
          },
        ],
      },
      AUTH,
    );
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({
      where: { externalId: "usr_new" },
    });
    expect(user).toBeTruthy();
    expect(user?.externalId).toBe("usr_new");
  });

  it("segment_name query param is used as fallback when no ht_segment_name in attributes", async () => {
    const req = new NextRequest(
      "http://localhost/api/ingest/segments?segment_name=param_segment",
      {
        method: "POST",
        body: JSON.stringify({
          users: [
            { external_user_id: "usr_param_1" },
            { external_user_id: "usr_param_2", attributes: {} },
          ],
        }),
        headers: { "Content-Type": "application/json", ...AUTH },
      },
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    const segments = await prisma.userSegment.findMany({
      where: { segmentName: "param_segment" },
    });
    expect(segments).toHaveLength(2);
  });

  it("accepts direct array format", async () => {
    const req = buildRequest(
      "POST",
      [
        { external_user_id: "usr_arr_1", attributes: { ht_segment_name: "arr_segment" } },
        { external_user_id: "usr_arr_2", attributes: { ht_segment_name: "arr_segment" } },
      ],
      AUTH,
    );
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(2);

    const count = await prisma.userSegment.count({ where: { segmentName: "arr_segment" } });
    expect(count).toBe(2);
  });
});

// ── response shape ─────────────────────────────────────────────────────────
describe("response shape", () => {
  it("returns { ok, received, upserted, skipped }", async () => {
    const req = buildRequest(
      "POST",
      {
        users: [
          { external_user_id: "usr_shape_1", attributes: { ht_segment_name: "shape_seg" } },
          { attributes: { ht_segment_name: "shape_seg" } }, // skipped — no identity
        ],
      },
      AUTH,
    );
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.received).toBe(2);
    expect(body.upserted).toBe(1);
    expect(body.skipped).toBe(1);
  });
});
