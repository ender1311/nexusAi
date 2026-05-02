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

  it("returns category and sourceTemplateId in response", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const template = await createVariant(msg.id, { name: "Tmpl", category: "general" });
    await createVariant(msg.id, {
      name: "Clone",
      category: "general",
      sourceTemplateId: template.id,
    });

    const req = new Request("http://localhost/api/variants") as NextRequest;
    const res = await GET(req);
    const body = await res.json();

    const clone = body.find((v: { name: string }) => v.name === "Clone");
    expect(clone.category).toBe("general");
    expect(clone.sourceTemplateId).toBe(template.id);
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
