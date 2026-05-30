import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { parseBody } from "@/lib/api/parse";
import { Prisma } from "@/generated/prisma/client";
import { buildRequest } from "../helpers/request";

describe("respond.ok", () => {
  it("wraps payload in { data } with 200 by default", async () => {
    const res = ok({ hello: "world" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { hello: "world" } });
  });

  it("honors an explicit status (e.g. 201)", async () => {
    const res = ok({ id: "abc" }, 201);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { id: "abc" } });
  });
});

describe("respond.fail", () => {
  it("wraps message in { error } with the given status", async () => {
    const res = fail("nope", 400);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "nope" });
  });
});

describe("respond.handleRouteError", () => {
  it("maps Prisma P2025 (not found) to 404", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("not found", {
      code: "P2025",
      clientVersion: "test",
    });
    const res = handleRouteError("ctx", err);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Resource not found" });
  });

  it("maps Prisma P2002 (unique violation) to 409", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("dupe", {
      code: "P2002",
      clientVersion: "test",
    });
    const res = handleRouteError("ctx", err);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A record with these values already exists" });
  });

  it("never leaks the underlying message for unknown errors → generic 500", async () => {
    const res = handleRouteError("ctx", new Error("secret internal detail"));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Internal server error");
    expect(json.error).not.toContain("secret");
  });
});

describe("parseBody", () => {
  const schema = z.object({
    name: z.string({ message: "is required" }).min(1, "is required"),
    count: z.number().optional(),
  });

  it("returns ok + typed data on a valid body", async () => {
    const req = buildRequest("POST", { name: "Ada", count: 3 }) as NextRequest;
    const parsed = await parseBody(req, schema);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data).toEqual({ name: "Ada", count: 3 });
  });

  it("returns a 400 'Invalid JSON body' for malformed JSON", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: "{not json",
      headers: { "Content-Type": "application/json" },
    }) as unknown as NextRequest;
    const parsed = await parseBody(req, schema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      expect(await parsed.response.json()).toEqual({ error: "Invalid JSON body" });
    }
  });

  it("returns a 400 with the path-prefixed message for a schema violation", async () => {
    const req = buildRequest("POST", { name: "" }) as NextRequest;
    const parsed = await parseBody(req, schema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      expect(await parsed.response.json()).toEqual({ error: "name: is required" });
    }
  });
});
