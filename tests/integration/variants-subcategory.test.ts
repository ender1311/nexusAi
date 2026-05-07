import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { GET } from "@/app/api/variants/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/variants — subcategory filter", () => {
  it("filters variants by subcategory", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "V1", category: "plans", subcategory: "find-plans" });
    await createVariant(msg.id, { name: "V2", category: "plans", subcategory: "my-plans" });
    await createVariant(msg.id, { name: "V3", category: "general" });

    const req = new Request("http://localhost/api/variants?subcategory=find-plans") as NextRequest;
    const res = await GET(req);
    const body = await res.json() as Array<{ name: string; subcategory: string | null }>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("V1");
    expect(body[0].subcategory).toBe("find-plans");
  });

  it("filters variants by category AND subcategory", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "V1", category: "plans", subcategory: "find-plans" });
    await createVariant(msg.id, { name: "V2", category: "plans", subcategory: "my-plans" });
    await createVariant(msg.id, { name: "V3", category: "bible-verse", subcategory: "my-plans" });

    const req = new Request("http://localhost/api/variants?category=plans&subcategory=my-plans") as NextRequest;
    const res = await GET(req);
    const body = await res.json() as Array<{ name: string; category: string; subcategory: string | null }>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("V2");
    expect(body[0].category).toBe("plans");
    expect(body[0].subcategory).toBe("my-plans");
  });

  it("returns all active variants when no params provided", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "V1", category: "plans", subcategory: "find-plans" });
    await createVariant(msg.id, { name: "V2", category: "plans", subcategory: "my-plans" });
    await createVariant(msg.id, { name: "V3", category: "bible-verse" });

    const req = new Request("http://localhost/api/variants") as NextRequest;
    const res = await GET(req);
    const body = await res.json() as unknown[];

    expect(res.status).toBe(200);
    expect(body).toHaveLength(3);
  });
});
