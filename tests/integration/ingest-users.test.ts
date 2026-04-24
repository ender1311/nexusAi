import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest, withAuth } from "../helpers/request";
import { POST } from "@/app/api/ingest/users/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("POST /api/ingest/users", () => {
  it("returns 401 without auth token", async () => {
    const req = buildRequest("POST", { external_user_id: "usr_1", attributes: {} });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 400 when external_user_id is missing", async () => {
    const req = buildRequest("POST", { attributes: {} }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("creates a user on first sync", async () => {
    const req = buildRequest("POST", { external_user_id: "usr_1", attributes: { plan: "devotional" } }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);

    const user = await prisma.user.findUnique({ where: { externalId: "usr_1" } });
    expect(user).toBeTruthy();
  });

  it("updates attributes on subsequent sync", async () => {
    await prisma.user.create({ data: { externalId: "usr_1", attributes: { plan: "old" } } });
    const req = buildRequest("POST", { external_user_id: "usr_1", attributes: { plan: "new" } }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { externalId: "usr_1" } });
    expect((user?.attributes as Record<string, string>).plan).toBe("new");
  });

  it("handles batch upsert and deduplication", async () => {
    const req = buildRequest("POST", {
      users: [
        { external_user_id: "usr_1", attributes: {} },
        { external_user_id: "usr_2", attributes: {} },
        { external_user_id: "usr_1", attributes: {} }, // duplicate
      ],
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(body.received).toBe(2);     // after dedup
    expect(body.deduplicated).toBe(1); // one dupe
    expect(body.upserted).toBe(2);

    const count = await prisma.user.count();
    expect(count).toBe(2);
  });
});
