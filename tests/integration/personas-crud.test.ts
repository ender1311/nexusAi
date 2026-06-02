import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createPersona } from "../helpers/builders";

import { POST } from "@/app/api/personas/route";
import { PUT } from "@/app/api/personas/[id]/route";

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

afterEach(async () => {
  await truncateAll();
});

describe("POST /api/personas", () => {
  it("creates a manual persona from a valid body", async () => {
    const req = buildRequest("POST", { name: "VIP Donors", description: "high-value givers" });
    const res = await POST(req as NextRequest);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("VIP Donors");
    expect(body.source).toBe("manual");
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await POST(rawRequest("POST", "{nope") as NextRequest);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("returns 400 when name is missing", async () => {
    const req = buildRequest("POST", { description: "no name" });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is a primitive", async () => {
    const res = await POST(rawRequest("POST", "\"just a string\"") as NextRequest);
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/personas/[id]", () => {
  it("updates core fields on an existing persona", async () => {
    const persona = await createPersona({ name: "Before" });
    const req = buildRequest("PUT", { name: "After", description: "updated" });
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: persona.id }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("After");
    expect(body.description).toBe("updated");
  });

  it("returns 400 on malformed JSON", async () => {
    const persona = await createPersona();
    const res = await PUT(rawRequest("PUT", "{bad") as NextRequest, { params: Promise.resolve({ id: persona.id }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON");
  });

  it("returns 400 when body is null", async () => {
    const persona = await createPersona();
    const res = await PUT(rawRequest("PUT", "null") as NextRequest, { params: Promise.resolve({ id: persona.id }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown persona", async () => {
    const req = buildRequest("PUT", { name: "Ghost" });
    const res = await PUT(req as NextRequest, { params: Promise.resolve({ id: "nonexistent-id" }) });
    expect(res.status).toBe(404);
  });
});
