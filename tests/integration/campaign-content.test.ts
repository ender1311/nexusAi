import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createCampaignContent } from "../helpers/builders";
import { buildRequest } from "../helpers/request";

// Mutable auth state — null user = unauthenticated, roles controls admin access
const mockAuth: {
  user: { id: string; email: string; firstName: null; lastName: null } | null;
  roles: string[];
} = {
  user: { id: "u1", email: "test@youversion.com", firstName: null, lastName: null },
  roles: ["admin"],
};

mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: mockAuth.user,
      roles: mockAuth.roles,
      sessionId: "sess1",
      accessToken: "tok1",
    }),
  signOut: async () => {},
}));

// Import AFTER mock.module so the mock takes effect
const { GET, POST } = await import("@/app/api/campaign-content/route");
const { PATCH, DELETE } = await import("@/app/api/campaign-content/[id]/route");

beforeEach(async () => {
  await truncateAll();
  mockAuth.user = { id: "u1", email: "test@youversion.com", firstName: null, lastName: null };
  mockAuth.roles = ["admin"];
});
afterEach(async () => {
  await truncateAll();
});

describe("GET /api/campaign-content", () => {
  it("requires campaign param", async () => {
    const req = new Request("http://localhost/api/campaign-content") as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns active rows for campaign", async () => {
    await createCampaignContent({ campaign: "resurrection-push", language: "en", usfmReference: "GEN.1.1", contentType: "a-title", title: "In the beginning…" });
    await createCampaignContent({ campaign: "resurrection-push", language: "en", usfmReference: "GEN.1.2", contentType: "b-title", title: "Genesis 1:2" });

    const req = new Request("http://localhost/api/campaign-content?campaign=resurrection-push") as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });

  it("filters by language when provided", async () => {
    await createCampaignContent({ language: "en", usfmReference: "GEN.1.1", contentType: "a-title", title: "EN title" });
    await createCampaignContent({ language: "de", usfmReference: "GEN.1.1", contentType: "a-title", title: "DE title" });

    const req = new Request("http://localhost/api/campaign-content?campaign=resurrection-push&language=de") as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].language).toBe("de");
  });

  it("excludes archived rows", async () => {
    await createCampaignContent({ usfmReference: "GEN.1.1", status: "active", contentType: "a-title", title: "Active" });
    await createCampaignContent({ usfmReference: "GEN.1.2", status: "archived", contentType: "a-title", title: "Archived" });

    const req = new Request("http://localhost/api/campaign-content?campaign=resurrection-push") as NextRequest;
    const res = await GET(req);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Active");
  });
});

describe("POST /api/campaign-content", () => {
  it("returns 403 when unauthenticated", async () => {
    mockAuth.user = null;
    mockAuth.roles = [];
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "a-title",
      language: "de",
      usfmReference: "GEN.1.1",
      title: "Test",
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid contentType", async () => {
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "invalid-type",
      language: "de",
      usfmReference: "GEN.1.1",
      title: "Test",
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/contentType/);
  });

  it("creates a-title row and returns 201", async () => {
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "a-title",
      language: "de",
      usfmReference: "ISA.43.18",
      usfmHuman: "Isaiah 43:18",
      title: "🌱 Gott wird etwas Neues tun…",
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.contentType).toBe("a-title");
    expect(body.data.language).toBe("de");
    expect(body.data.title).toBe("🌱 Gott wird etwas Neues tun…");
  });

  it("returns 409 on duplicate", async () => {
    await createCampaignContent({ usfmReference: "ISA.43.18", contentType: "a-title", language: "de", title: "Existing" });

    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "a-title",
      language: "de",
      usfmReference: "ISA.43.18",
      title: "Duplicate",
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it("requires body for verse-text contentType", async () => {
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "verse-text",
      language: "en",
      usfmReference: "ISA.43.18",
      // body omitted intentionally
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/body/);
  });

  it("returns 400 when title is missing for a-title", async () => {
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "a-title",
      language: "de",
      usfmReference: "GEN.1.1",
      // title omitted intentionally
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/title/);
  });

  it("accepts a reference contentType with a body and returns 201", async () => {
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "reference",
      language: "es",
      usfmReference: "JHN.3.16",
      body: "Juan 3:16",
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.contentType).toBe("reference");
    expect(body.data.body).toBe("Juan 3:16");
  });

  it("rejects a reference contentType without a body", async () => {
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "reference",
      language: "es",
      usfmReference: "JHN.3.16",
      // body omitted intentionally
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/body/);
  });
});

describe("PATCH /api/campaign-content/[id]", () => {
  it("returns 403 when unauthenticated", async () => {
    mockAuth.user = null;
    mockAuth.roles = [];
    const row = await createCampaignContent({ usfmReference: "GEN.1.1", contentType: "a-title", title: "Original" });
    const req = buildRequest("PATCH", { title: "Updated" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown id", async () => {
    const req = buildRequest("PATCH", { title: "Updated" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid status value", async () => {
    const row = await createCampaignContent({ usfmReference: "GEN.1.1" });
    const req = buildRequest("PATCH", { status: "invalid-status" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/status/);
  });

  it("updates title and returns the row", async () => {
    const row = await createCampaignContent({ usfmReference: "GEN.1.1", contentType: "a-title", title: "Original" });
    const req = buildRequest("PATCH", { title: "Updated title" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("Updated title");

    const inDb = await prisma.campaignContent.findUnique({ where: { id: row.id } });
    expect(inDb!.title).toBe("Updated title");
  });
});

describe("DELETE /api/campaign-content/[id]", () => {
  it("returns 403 when unauthenticated", async () => {
    mockAuth.user = null;
    mockAuth.roles = [];
    const row = await createCampaignContent({ usfmReference: "GEN.1.1" });
    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown id", async () => {
    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("soft-deletes by setting status=archived and returns id", async () => {
    const row = await createCampaignContent({ usfmReference: "GEN.1.1" });
    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(row.id);

    const inDb = await prisma.campaignContent.findUnique({ where: { id: row.id } });
    expect(inDb!.status).toBe("archived");

    // Verify excluded from GET
    const getReq = new Request("http://localhost/api/campaign-content?campaign=resurrection-push") as NextRequest;
    const getRes = await GET(getReq);
    const getBody = await getRes.json();
    expect(getBody.data.map((r: { id: string }) => r.id)).not.toContain(row.id);
  });
});
