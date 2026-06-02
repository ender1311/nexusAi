import { beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

// Must mock before importing routes that call requireAdmin()
mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: { id: "test-user", email: "test@youversion.com", firstName: "Test", lastName: "User" },
      roles: ["admin"],
      sessionId: "sess1",
      accessToken: "tok1",
    }),
  signOut: async () => {},
}));

// Import AFTER mock.module so the mock takes effect
const { POST: postMessage, PUT: putMessage } = await import("@/app/api/agents/[id]/messages/route");
const { PATCH: patchVariant, DELETE: deleteVariant } = await import("@/app/api/variants/[id]/route");

function rawRequest(method: "POST" | "PUT", body: string): Request {
  return new Request("http://localhost/", {
    method,
    body,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  await truncateAll();
});

describe("POST /api/agents/[id]/messages", () => {
  it("creates a push message with variants", async () => {
    const agent = await createAgent();

    const req = buildRequest("POST", {
      name: "Re-engagement Push",
      channel: "push",
      variants: [
        { name: "V1", title: "Title 1", body: "Body 1", deeplink: "youversion://bible" },
        { name: "V2", title: "Title 2", body: "Body 2" },
      ],
    });
    const res = await postMessage(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.name).toBe("Re-engagement Push");
    expect(body.variants).toHaveLength(2);
    expect(body.variants[0].name).toBe("V1");
  });

  it("adds a variant to an existing message when messageId is provided", async () => {
    const agent = await createAgent();
    const message = await createMessage(agent.id, { channel: "push" });
    await createVariant(message.id, { name: "V1", body: "Existing body" });

    const req = buildRequest("POST", {
      messageId: message.id,
      variant: {
        name: "V2",
        body: "New body",
        title: "New title",
      },
    });
    const res = await postMessage(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe(message.id);
    expect(body.variants).toHaveLength(2);
    expect(body.variants.some((v: { name: string }) => v.name === "V2")).toBe(true);
  });

  it("persists sourceTemplateId when cloning a library template into a new message", async () => {
    // Regression: sanitizeVariant once dropped sourceTemplateId, so template lineage
    // was lost whenever a push was added to an agent via the picker (existing-agent path).
    const libAgent = await createAgent({ name: "Push Copy Library", status: "draft" });
    const libMsg = await createMessage(libAgent.id, { channel: "push" });
    const template = await createVariant(libMsg.id, { name: "Tpl", body: "Template body" });

    const agent = await createAgent();
    const req = buildRequest("POST", {
      name: "Cloned Message",
      channel: "push",
      variants: [{ name: "V1", body: "Cloned body", sourceTemplateId: template.id }],
    });
    const res = await postMessage(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.variants[0].sourceTemplateId).toBe(template.id);

    const inDb = await prisma.messageVariant.findUnique({ where: { id: body.variants[0].id } });
    expect(inDb!.sourceTemplateId).toBe(template.id);
  });

  it("persists sourceTemplateId when adding a cloned variant to an existing message", async () => {
    const libAgent = await createAgent({ name: "Push Copy Library", status: "draft" });
    const libMsg = await createMessage(libAgent.id, { channel: "push" });
    const template = await createVariant(libMsg.id, { name: "Tpl", body: "Template body" });

    const agent = await createAgent();
    const message = await createMessage(agent.id, { channel: "push" });
    await createVariant(message.id, { name: "V1", body: "Existing body" });

    const req = buildRequest("POST", {
      messageId: message.id,
      variant: { name: "V2", body: "New body", sourceTemplateId: template.id },
    });
    const res = await postMessage(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    const added = body.variants.find((v: { name: string }) => v.name === "V2");
    const inDb = await prisma.messageVariant.findUnique({ where: { id: added.id } });
    expect(inDb!.sourceTemplateId).toBe(template.id);
  });
});

describe("PATCH/DELETE /api/variants/[id]", () => {
  it("updates push variant copy fields", async () => {
    const agent = await createAgent();
    const message = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(message.id, {
      name: "Before",
      title: "Before title",
      body: "Before body",
    });

    const req = buildRequest("PATCH", {
      name: "After",
      title: "After title",
      body: "After body",
      deeplink: "youversion://plans",
    });
    const res = await patchVariant(req as NextRequest, { params: Promise.resolve({ id: variant.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe("After");
    expect(body.data.title).toBe("After title");
    expect(body.data.deeplink).toBe("youversion://plans");
  });

  it("deletes a variant", async () => {
    const agent = await createAgent();
    const message = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(message.id, { name: "Delete me" });

    const req = buildRequest("DELETE");
    const res = await deleteVariant(req as NextRequest, { params: Promise.resolve({ id: variant.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(variant.id);

    const deleted = await prisma.messageVariant.findUnique({ where: { id: variant.id } });
    expect(deleted).toBeNull();
  });
});

describe("PUT /api/agents/[id]/messages", () => {
  it("updates a message name and channel", async () => {
    const agent = await createAgent();
    const message = await createMessage(agent.id, { channel: "push" });

    const req = buildRequest("PUT", { messageId: message.id, name: "Renamed", channel: "email" });
    const res = await putMessage(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(200);
    const updated = await prisma.message.findUnique({ where: { id: message.id } });
    expect(updated!.name).toBe("Renamed");
    expect(updated!.channel).toBe("email");
  });

  it("returns 400 on malformed JSON", async () => {
    const agent = await createAgent();
    const res = await putMessage(rawRequest("PUT", "{bad") as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("returns 400 when messageId is missing", async () => {
    const agent = await createAgent();
    const req = buildRequest("PUT", { name: "No id" });
    const res = await putMessage(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns 400 when messageId is an empty string", async () => {
    const agent = await createAgent();
    const req = buildRequest("PUT", { messageId: "   ", name: "Blank id" });
    const res = await putMessage(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown messageId", async () => {
    const agent = await createAgent();
    const req = buildRequest("PUT", { messageId: "nonexistent-id", name: "Ghost" });
    const res = await putMessage(req as NextRequest, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(404);
  });
});
