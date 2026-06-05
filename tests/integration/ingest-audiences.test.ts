import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { POST } from "@/app/api/ingest/audiences/route";

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
    const req = buildRequest("POST", {
      cohort_id: "cohort_abc",
      cohort_changes: [{ user_ids: ["u1"] }],
    });
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const req = buildRequest(
      "POST",
      { cohort_id: "cohort_abc", cohort_changes: [{ user_ids: ["u1"] }] },
      { Authorization: "Bearer wrong_token" },
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(401);
  });
});

// ── validation ─────────────────────────────────────────────────────────────
describe("validation", () => {
  it("returns 400 when cohort_id is missing", async () => {
    const req = buildRequest(
      "POST",
      { cohort_changes: [{ user_ids: ["u1"] }] },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when cohort_id is empty string", async () => {
    const req = buildRequest(
      "POST",
      { cohort_id: "   ", cohort_changes: [{ user_ids: ["u1"] }] },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when cohort_id is present but no user ids are provided", async () => {
    const req = buildRequest("POST", { cohort_id: "cohort_abc" }, AUTH);
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when cohort_changes is not an array", async () => {
    const req = buildRequest(
      "POST",
      { cohort_id: "cohort_abc", cohort_changes: "not_an_array" },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when batch exceeds 10,000", async () => {
    // 10,001 user_ids across cohort_changes
    const userIds = Array.from({ length: 10_001 }, (_, i) => `user_${i}`);
    const req = buildRequest(
      "POST",
      { cohort_id: "big_cohort", cohort_changes: [{ user_ids: userIds }] },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("10,000");
  });
});

// ── Hightouch column mapping (user_id) ─────────────────────────────────────
describe("Hightouch column mapping", () => {
  it("upserts from top-level user_id", async () => {
    const cohortId = "test_cohort_ht_flat";
    const req = buildRequest(
      "POST",
      { cohort_id: cohortId, user_id: "123456" },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(1);
    expect(body.upserted).toBe(1);

    const segment = await prisma.userSegment.findFirst({
      where: { externalId: "123456", segmentName: cohortId },
    });
    expect(segment).toBeTruthy();
  });

  it("upserts from users array with user_id rows", async () => {
    const cohortId = "test_cohort_ht_users";
    const req = buildRequest(
      "POST",
      {
        cohort_id: cohortId,
        users: [{ user_id: "u1" }, { user_id: "u2" }],
      },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(2);
    expect(body.upserted).toBe(2);

    const segments = await prisma.userSegment.findMany({
      where: { segmentName: cohortId },
    });
    expect(segments).toHaveLength(2);
  });

  it("upserts from singular user_id inside cohort_changes", async () => {
    const cohortId = "test_cohort_ht_change";
    const req = buildRequest(
      "POST",
      {
        cohort_id: cohortId,
        cohort_changes: [{ user_id: "u1" }, { user_id: "u2" }],
      },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(2);
    expect(body.upserted).toBe(2);
  });
});

// ── external user_ids ──────────────────────────────────────────────────────
describe("external user_ids", () => {
  it("upserts UserSegment records for each user_id", async () => {
    const cohortId = "test_cohort_ext";
    const req = buildRequest(
      "POST",
      {
        cohort_id: cohortId,
        cohort_changes: [{ user_ids: ["u1", "u2"] }],
      },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.received).toBe(2);
    expect(body.upserted).toBe(2);
    expect(body.skipped).toBe(0);
    expect(body.cohort_id).toBe(cohortId);

    const segments = await prisma.userSegment.findMany({
      where: { segmentName: cohortId },
    });
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.externalId).sort()).toEqual(["u1", "u2"]);
  });

  it("is idempotent — second POST with same payload does not create duplicate UserSegment records", async () => {
    const cohortId = "test_cohort_idem";
    const payload = {
      cohort_id: cohortId,
      cohort_changes: [{ user_ids: ["u1", "u2"] }],
    };

    const req1 = buildRequest("POST", payload, AUTH);
    await POST(req1 as unknown as NextRequest);

    const req2 = buildRequest("POST", payload, AUTH);
    await POST(req2 as unknown as NextRequest);

    const count = await prisma.userSegment.count({
      where: { segmentName: cohortId },
    });
    expect(count).toBe(2);
  });

  it("flattens user_ids across multiple cohort_changes objects", async () => {
    const cohortId = "test_cohort_flatten";
    const req = buildRequest(
      "POST",
      {
        cohort_id: cohortId,
        cohort_changes: [
          { user_ids: ["u1"] },
          { user_ids: ["u2", "u3"] },
        ],
      },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(3);
    expect(body.upserted).toBe(3);
  });
});

// ── braze_user_ids ─────────────────────────────────────────────────────────
describe("braze_user_ids", () => {
  it("creates unverified TrackedUser and UserSegment for unknown brazeId", async () => {
    const cohortId = "test_cohort_braze_new";
    const req = buildRequest(
      "POST",
      {
        cohort_id: cohortId,
        cohort_changes: [{ braze_user_ids: ["braze_abc"] }],
      },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(1);
    expect(body.upserted).toBe(1);

    const user = await prisma.trackedUser.findUnique({
      where: { externalId: "braze_abc" },
    });
    expect(user).toBeTruthy();
    expect(user?.externalId).toBe("braze_abc");
    expect(user?.brazeId).toBe("braze_abc");

    const segment = await prisma.userSegment.findFirst({
      where: { externalId: "braze_abc", segmentName: cohortId },
    });
    expect(segment).toBeTruthy();
  });

  it("resolves existing TrackedUser by brazeId and links to their externalId", async () => {
    const cohortId = "test_cohort_braze_resolve";
    // Seed a TrackedUser with a known externalId and brazeId
    await prisma.trackedUser.create({
      data: { externalId: "yv_user_123", brazeId: "braze_xyz" },
    });

    const req = buildRequest(
      "POST",
      {
        cohort_id: cohortId,
        cohort_changes: [{ braze_user_ids: ["braze_xyz"] }],
      },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(1);
    expect(body.upserted).toBe(1);

    // UserSegment should be keyed by the real externalId, not the brazeId
    const segment = await prisma.userSegment.findFirst({
      where: { externalId: "yv_user_123", segmentName: cohortId },
    });
    expect(segment).toBeTruthy();

    // Must NOT have created a segment under the brazeId
    const wrongSegment = await prisma.userSegment.findFirst({
      where: { externalId: "braze_xyz", segmentName: cohortId },
    });
    expect(wrongSegment).toBeNull();
  });

  it("skips brazeId that would collide with a verified user's externalId (collision guard)", async () => {
    const cohortId = "test_cohort_braze_collision";
    // Seed a verified TrackedUser whose externalId happens to equal the brazeId we'll send
    await prisma.trackedUser.create({
      data: { externalId: "collision_id", brazeId: null },
    });

    const req = buildRequest(
      "POST",
      {
        cohort_id: cohortId,
        cohort_changes: [{ braze_user_ids: ["collision_id"] }],
      },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.skipped).toBe(1);

    // The verified user must NOT have been enrolled in the cohort
    const segment = await prisma.userSegment.findFirst({
      where: { externalId: "collision_id", segmentName: cohortId },
    });
    expect(segment).toBeNull();
  });
});

// ── mixed ──────────────────────────────────────────────────────────────────
describe("mixed", () => {
  it("handles user_ids and braze_user_ids in same cohort_changes", async () => {
    const cohortId = "test_cohort_mixed";
    const req = buildRequest(
      "POST",
      {
        cohort_id: cohortId,
        cohort_changes: [{ user_ids: ["ext1"], braze_user_ids: ["braze_1"] }],
      },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.received).toBe(2);

    const segments = await prisma.userSegment.findMany({
      where: { segmentName: cohortId },
    });
    expect(segments).toHaveLength(2);
  });
});

// ── logging ────────────────────────────────────────────────────────────────
describe("logging", () => {
  it("creates IngestSyncLog with syncKind 'audience_sync'", async () => {
    const req = buildRequest(
      "POST",
      {
        cohort_id: "test_cohort_log",
        cohort_changes: [{ user_ids: ["u1", "u2"] }],
      },
      AUTH,
    );
    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);

    const log = await prisma.ingestSyncLog.findFirst({
      where: { syncKind: "audience_sync" },
    });
    expect(log).toBeTruthy();
    expect(log?.received).toBeGreaterThan(0);
  });
});
