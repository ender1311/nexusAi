import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { buildRequest } from "../helpers/request";

// Mutable auth state — mutate before each test that needs a specific role
const mockAuth: { roles: string[] } = { roles: [] };

mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: { id: "u1", email: "test@youversion.com", firstName: null, lastName: null },
      roles: mockAuth.roles,
      sessionId: "sess1",
      accessToken: "tok1",
    }),
  signOut: async () => {},
}));

// Import AFTER mock.module so the mock takes effect
const { GET, POST } = await import("@/app/api/push-library/route");
const { DELETE } = await import("@/app/api/push-library/[id]/route");

const LIBRARY_AGENT_NAME = "Push Copy Library";

beforeEach(async () => {
  await truncateAll();
  mockAuth.roles = [];
});
afterEach(async () => {
  await truncateAll();
});

// Helper: seed a minimal library agent with one variant
async function seedLibrary() {
  const agent = await createAgent({ name: LIBRARY_AGENT_NAME, status: "draft" });
  const msg = await createMessage(agent.id);
  const variant = await createVariant(msg.id, {
    name: "Open Bible",
    title: "Build your Bible habit!",
    body: "Build your Bible habit today.",
    deeplink: "youversion://bible",
    category: "reader",
    subcategory: "open-bible",
    status: "active",
  });
  return { agent, msg, variant };
}

describe("GET /api/push-library", () => {
  it("returns grouped variants for authenticated user", async () => {
    await seedLibrary();
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty("category");
    expect(body.data[0]).toHaveProperty("variants");
    expect(body.data[0].variants[0]).toHaveProperty("id");
    expect(body.data[0].variants[0]).toHaveProperty("name");
    expect(body.data[0].variants[0]).toHaveProperty("body");
  });

  it("excludes archived variants", async () => {
    const agent = await createAgent({ name: LIBRARY_AGENT_NAME, status: "draft" });
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, {
      name: "Active",
      body: "active body",
      category: "reader",
      status: "active",
    });
    await createVariant(msg.id, {
      name: "Archived",
      body: "archived body",
      category: "reader",
      status: "archived",
    });

    const res = await GET();
    const body = await res.json();

    const names = body.data.flatMap((g: { variants: { name: string }[] }) =>
      g.variants.map((v: { name: string }) => v.name)
    );
    expect(names).toContain("Active");
    expect(names).not.toContain("Archived");
  });
});

describe("POST /api/push-library", () => {
  it("returns 403 for non-admin", async () => {
    mockAuth.roles = [];
    await seedLibrary();

    const req = buildRequest("POST", {
      name: "New Template",
      category: "reader",
      subcategory: "open-bible",
      body: "Test body",
    }) as NextRequest;
    const res = await POST(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("creates variant under library agent for admin", async () => {
    mockAuth.roles = ["admin"];
    await seedLibrary();

    const req = buildRequest("POST", {
      name: "New Reminder",
      category: "reader",
      subcategory: "open-bible",
      title: "Read today",
      body: "Spend time with God.",
      deeplink: "youversion://bible",
      cta: "Open Bible App",
    }) as NextRequest;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toHaveProperty("id");
    expect(body.data.name).toBe("New Reminder");
    expect(body.data.category).toBe("reader");
    expect(body.data.subcategory).toBe("open-bible");
    expect(body.data.body).toBe("Spend time with God.");
    expect(body.data.deeplink).toBe("youversion://bible");
    expect(body.data.cta).toBe("Open Bible App");

    // Verify it appears in GET
    const getRes = await GET();
    const getBody = await getRes.json();
    const allNames = getBody.data.flatMap((g: { variants: { name: string }[] }) =>
      g.variants.map((v: { name: string }) => v.name)
    );
    expect(allNames).toContain("New Reminder");
  });

  it("returns 400 when body is missing", async () => {
    mockAuth.roles = ["admin"];
    await seedLibrary();

    const req = buildRequest("POST", {
      name: "Missing body",
      category: "reader",
    }) as NextRequest;
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("creates a variant in the giving category", async () => {
    mockAuth.roles = ["admin"];
    await seedLibrary();

    const req = buildRequest("POST", {
      name: "2026-01 Giving — When you make generosity a habit",
      category: "giving",
      subcategory: "sower-generosity",
      title: "When you make generosity a habit…",
      body: "It changes lives. Discover what it means to be a Sower of God’s Word ➡️",
      deeplink: "https://bible.com/blog/?p=267608",
    }) as NextRequest;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.category).toBe("giving");
    expect(body.data.subcategory).toBe("sower-generosity");

    const getRes = await GET();
    const getBody = await getRes.json();
    const givingGroup = getBody.data.find(
      (g: { category: string }) => g.category === "giving"
    );
    expect(givingGroup).toBeDefined();
  });

  it("returns 400 for an unrecognized category", async () => {
    mockAuth.roles = ["admin"];
    await seedLibrary();

    const req = buildRequest("POST", {
      name: "Bad Category",
      category: "not-a-real-category",
      body: "Some body",
    }) as NextRequest;
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });
});

describe("specific-verse deeplinks", () => {
  it("POST /api/push-library creates specific-verse variant with USFM deeplink", async () => {
    mockAuth.roles = ["admin"];
    await seedLibrary();

    const req = buildRequest("POST", {
      name: "Verse of the Day",
      category: "reader",
      subcategory: "specific-verse",
      body: "Read Matthew 1:1 today.",
      deeplink: "youversion://bible?reference=MAT.1.1",
    }) as NextRequest;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.deeplink).toBe("youversion://bible?reference=MAT.1.1");
    expect(body.data.subcategory).toBe("specific-verse");
    expect(body.data.name).toBe("Verse of the Day");
    expect(body.data.body).toBe("Read Matthew 1:1 today.");
  });

  it("POST /api/push-library creates specific-verse variant with generic deeplink", async () => {
    mockAuth.roles = ["admin"];
    await seedLibrary();

    const req = buildRequest("POST", {
      name: "Open Bible Generic",
      category: "reader",
      subcategory: "specific-verse",
      body: "Tap to read your Bible.",
      deeplink: "youversion://bible",
    }) as NextRequest;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.deeplink).toBe("youversion://bible");
    expect(body.data.subcategory).toBe("specific-verse");
  });

  it("GET /api/push-library returns specific-verse deeplink in grouped response", async () => {
    const { agent } = await seedLibrary();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id, {
      name: "John 3:16",
      title: "The Greatest Love",
      body: "For God so loved the world...",
      deeplink: "youversion://bible?reference=JHN.3.16",
      category: "reader",
      subcategory: "specific-verse",
      status: "active",
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    const allVariants = body.data.flatMap((g: { variants: unknown[] }) => g.variants);
    const foundVariant = allVariants.find(
      (v: { id: string }) => v.id === variant.id
    ) as { deeplink?: string; subcategory?: string } | undefined;

    expect(foundVariant).toBeDefined();
    expect(foundVariant?.deeplink).toBe("youversion://bible?reference=JHN.3.16");
    expect(foundVariant?.subcategory).toBe("specific-verse");
  });
});

describe("DELETE /api/push-library/[id]", () => {
  it("returns 403 for non-admin", async () => {
    mockAuth.roles = [];
    const { variant } = await seedLibrary();

    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: variant.id }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("archives variant for admin and removes from GET", async () => {
    mockAuth.roles = ["admin"];
    const { variant } = await seedLibrary();

    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: variant.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(variant.id);

    // Verify archived in DB
    const inDb = await prisma.messageVariant.findUnique({ where: { id: variant.id } });
    expect(inDb).not.toBeNull();
    expect(inDb!.status).toBe("archived");

    // Verify excluded from GET
    const getRes = await GET();
    const getBody = await getRes.json();
    const allIds = getBody.data.flatMap((g: { variants: { id: string }[] }) =>
      g.variants.map((v: { id: string }) => v.id)
    );
    expect(allIds).not.toContain(variant.id);
  });

  it("returns 404 for unknown variant", async () => {
    mockAuth.roles = ["admin"];

    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: "nonexistent" }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 when deleting a variant that belongs to a non-library agent", async () => {
    // Regression: DELETE must reject variants outside the library agent to prevent
    // operators from accidentally archiving production send variants via this endpoint.
    mockAuth.roles = ["admin"];
    const agent = await createAgent({ name: "Regular Agent", status: "active" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id, { name: "Regular Variant", body: "body", status: "active" });

    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: variant.id }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");

    // Verify not archived
    const inDb = await prisma.messageVariant.findUnique({ where: { id: variant.id } });
    expect(inDb!.status).toBe("active");
  });
});
