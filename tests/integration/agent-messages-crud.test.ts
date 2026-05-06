import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { POST as postMessage } from "@/app/api/agents/[id]/messages/route";
import { PATCH as patchVariant, DELETE as deleteVariant } from "@/app/api/variants/[id]/route";

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
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
