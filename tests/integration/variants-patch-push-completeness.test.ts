import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { buildRequest } from "../helpers/request";

const mockAuth: { roles: string[] } = { roles: ["admin"] };

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

const { PATCH } = await import("@/app/api/variants/[id]/route");

beforeEach(async () => {
  await truncateAll();
  mockAuth.roles = ["admin"];
});
afterEach(async () => {
  await truncateAll();
});

async function pushVariant(overrides: { title?: string | null; body?: string } = {}) {
  const agent = await createAgent({ name: "Sender", status: "active" });
  const msg = await createMessage(agent.id, { channel: "push" });
  return createVariant(msg.id, { name: "V", title: "Title", body: "Body", ...overrides });
}

function patch(id: string, body: Record<string, unknown>) {
  return PATCH(buildRequest("PATCH", body) as NextRequest, {
    params: Promise.resolve({ id }),
  });
}

describe("PATCH /api/variants/[id] — push completeness", () => {
  it("rejects clearing the title on a push variant", async () => {
    const v = await pushVariant();
    const res = await patch(v.id, { title: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/title/i);

    const inDb = await prisma.messageVariant.findUnique({ where: { id: v.id } });
    expect(inDb!.title).toBe("Title");
  });

  it("rejects clearing the body on a push variant", async () => {
    const v = await pushVariant();
    const res = await patch(v.id, { body: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/body/i);
  });

  it("allows editing the title to a non-empty value", async () => {
    const v = await pushVariant();
    const res = await patch(v.id, { title: "New title" });
    expect(res.status).toBe(200);
    const inDb = await prisma.messageVariant.findUnique({ where: { id: v.id } });
    expect(inDb!.title).toBe("New title");
  });

  it("allows clearing the title on a non-push (email) variant", async () => {
    const agent = await createAgent({ name: "Sender", status: "active" });
    const msg = await createMessage(agent.id, { channel: "email" });
    const v = await createVariant(msg.id, { name: "E", title: "Subject", body: "Body" });

    const res = await patch(v.id, { title: "" });
    expect(res.status).toBe(200);
    const inDb = await prisma.messageVariant.findUnique({ where: { id: v.id } });
    expect(inDb!.title).toBe("");
  });
});
