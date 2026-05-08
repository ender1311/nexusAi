import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createPersona } from "../helpers/builders";
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

// ── auth + basic shape ─────────────────────────────────────────────────────
describe("auth + basic shape", () => {
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

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_1" } });
    expect(user).toBeTruthy();
  });

  it("updates attributes on subsequent sync", async () => {
    await prisma.trackedUser.create({ data: { externalId: "usr_1", attributes: { plan: "old" } } });
    const req = buildRequest("POST", { external_user_id: "usr_1", attributes: { plan: "new" } }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_1" } });
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

    const count = await prisma.trackedUser.count();
    expect(count).toBe(2);
  });
});

// ── batch formats ──────────────────────────────────────────────────────────
describe("batch formats", () => {
  it("accepts top-level array format", async () => {
    const req = buildRequest("POST", [
      { external_user_id: "usr_arr_1", attributes: {} },
      { external_user_id: "usr_arr_2", attributes: {} },
    ], AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(2);

    const count = await prisma.trackedUser.count();
    expect(count).toBe(2);
  });

  it("skips anonymous users (no external_user_id) silently", async () => {
    const req = buildRequest("POST", {
      users: [
        { attributes: { plan: "devotional" } }, // no external_user_id — anonymous
        { external_user_id: "usr_named", attributes: {} },
      ],
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);
    expect(body.skipped_anonymous).toBe(1);
  });

  it("returns early with upserted=0 when all users are anonymous", async () => {
    const req = buildRequest("POST", {
      users: [{ attributes: {} }],
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(0);
    expect(body.skipped_anonymous).toBe(1);

    const count = await prisma.trackedUser.count();
    expect(count).toBe(0);
  });
});

// ── last_seen_at → preferred send time ────────────────────────────────────
describe("last_seen_at → preferred send time", () => {
  it("stores preferredSendHour and preferredSendMinute from last_seen_at UTC time", async () => {
    const req = buildRequest("POST", {
      external_user_id: "usr_seen",
      attributes: { last_seen_at: "2026-05-08T14:37:00Z" },
    }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_seen" } });
    expect(user!.preferredSendHour).toBe(14);
    expect(user!.preferredSendMinute).toBe(37);
  });

  it("does not set preferred send time when last_seen_at is absent", async () => {
    const req = buildRequest("POST", {
      external_user_id: "usr_no_seen",
      attributes: { plan: "devotional" },
    }, AUTH);
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_no_seen" } });
    expect(user!.preferredSendHour).toBeNull();
    expect(user!.preferredSendMinute).toBeNull();
  });

  it("overwrites stale preferred send time on re-sync", async () => {
    await prisma.trackedUser.create({
      data: { externalId: "usr_resync", preferredSendHour: 10, preferredSendMinute: 0 },
    });

    const req = buildRequest("POST", {
      external_user_id: "usr_resync",
      attributes: { last_seen_at: "2026-05-08T20:15:00Z" },
    }, AUTH);
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_resync" } });
    expect(user!.preferredSendHour).toBe(20);
    expect(user!.preferredSendMinute).toBe(15);
  });
});

// ── funnel_stage + persona assignment ─────────────────────────────────────
describe("funnel_stage + persona assignment", () => {
  it("assigns Re-engager persona for funnel_stage: lapsed", async () => {
    const reEngager = await createPersona({ name: "Re-engager", label: "Re-engager" });

    const req = buildRequest("POST", {
      external_user_id: "usr_lapsed",
      funnel_stage: "lapsed",
      attributes: {},
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.persona_assigned).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_lapsed" } });
    expect(user!.personaId).toBe(reEngager.id);
  });

  it("assigns Re-engager persona for funnel_stage: lapsed_mau", async () => {
    const reEngager = await createPersona({ name: "Re-engager", label: "Re-engager" });

    const req = buildRequest("POST", {
      external_user_id: "usr_lapsed_mau",
      funnel_stage: "lapsed_mau",
      attributes: {},
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body.persona_assigned).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_lapsed_mau" } });
    expect(user!.personaId).toBe(reEngager.id);
  });

  it("stores funnel_stage on the user record", async () => {
    const req = buildRequest("POST", {
      external_user_id: "usr_funnel",
      funnel_stage: "core",
      attributes: {},
    }, AUTH);
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_funnel" } });
    expect(user!.funnelStage).toBe("core");
  });

  it("updates funnel_stage on re-sync", async () => {
    await prisma.trackedUser.create({
      data: { externalId: "usr_funnel_upd", funnelStage: "lapsed" },
    });

    const req = buildRequest("POST", {
      external_user_id: "usr_funnel_upd",
      funnel_stage: "core",
      attributes: {},
    }, AUTH);
    await POST(req as NextRequest);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_funnel_upd" } });
    expect(user!.funnelStage).toBe("core");
  });

  it("falls back to Bible-first persona when classifier returns null", async () => {
    const biblePer = await createPersona({ name: "Bible-first", label: "Bible-first" });

    // Attributes produce no strong classifier signal → classifyPersona returns null → "Bible-first" fallback
    const req = buildRequest("POST", {
      external_user_id: "usr_fallback",
      funnel_stage: "connected",
      attributes: { plan_finish_lifetime_count: 1 },
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body.persona_assigned).toBe(1);

    const user = await prisma.trackedUser.findUnique({ where: { externalId: "usr_fallback" } });
    expect(user!.personaId).toBe(biblePer.id);
  });

  it("counts all assigned personas in persona_assigned field", async () => {
    await createPersona({ name: "Re-engager", label: "Re-engager" });

    const req = buildRequest("POST", {
      users: [
        { external_user_id: "usr_pa_1", funnel_stage: "lapsed", attributes: {} },
        { external_user_id: "usr_pa_2", funnel_stage: "lapsed_mau", attributes: {} },
        { external_user_id: "usr_pa_3", funnel_stage: "core", attributes: {} }, // no matching persona
      ],
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body.upserted).toBe(3);
    expect(body.persona_assigned).toBe(2); // only the two lapsed users
  });
});

// ── response shape ─────────────────────────────────────────────────────────
describe("response shape", () => {
  it("includes all expected fields in the response", async () => {
    const req = buildRequest("POST", {
      external_user_id: "usr_resp",
      attributes: {},
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body).toHaveProperty("ok", true);
    expect(body).toHaveProperty("received");
    expect(body).toHaveProperty("deduplicated");
    expect(body).toHaveProperty("skipped_anonymous");
    expect(body).toHaveProperty("upserted");
    expect(body).toHaveProperty("persona_assigned");
  });
});
