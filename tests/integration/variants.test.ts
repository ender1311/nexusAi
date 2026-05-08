import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { GET } from "@/app/api/variants/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/variants", () => {
  it("returns all active variants when no category param", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "V1", category: "bible-verse" });
    await createVariant(msg.id, { name: "V2", category: "plans" });

    const req = new Request("http://localhost/api/variants") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
  });

  it("filters variants by category", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "V1", category: "bible-verse" });
    await createVariant(msg.id, { name: "V2", category: "plans" });
    await createVariant(msg.id, { name: "V3", category: "bible-verse" });

    const req = new Request("http://localhost/api/variants?category=bible-verse") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body.every((v: { category: string }) => v.category === "bible-verse")).toBe(true);
  });

  it("excludes clones (sourceTemplateId set) — only library templates appear", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const template = await createVariant(msg.id, { name: "Template", category: "general" });
    await createVariant(msg.id, {
      name: "Clone",
      category: "general",
      sourceTemplateId: template.id,
    });

    const req = new Request("http://localhost/api/variants") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    // Only the library template (sourceTemplateId: null) should appear
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Template");
    expect(body[0].sourceTemplateId).toBeNull();
  });

  it("filters variants by channel", async () => {
    const agent = await createAgent();
    const pushMsg = await createMessage(agent.id, { channel: "push" });
    const emailMsg = await createMessage(agent.id, { channel: "email" });
    await createVariant(pushMsg.id, { name: "Push V1" });
    await createVariant(emailMsg.id, { name: "Email V1" });

    const req = new Request("http://localhost/api/variants?channel=push") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Push V1");
  });

  it("excludes inactive variants", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "Active", status: "active" });
    await createVariant(msg.id, { name: "Inactive", status: "archived" });

    const req = new Request("http://localhost/api/variants") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Active");
  });
});
