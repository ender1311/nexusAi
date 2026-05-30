import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { POST as migrate } from "@/app/api/personas/migrate/route";

async function post(body: unknown) {
  return migrate(buildRequest("POST", body) as NextRequest);
}

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("POST /api/personas/migrate", () => {
  it("returns 400 when neither deactivateIds nor activateIds is provided", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Provide at least one of deactivateIds or activateIds");
  });

  it("returns 400 for malformed JSON", async () => {
    const req = new Request("http://localhost/", {
      method: "POST",
      body: "{not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await migrate(req as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({ error: "Invalid JSON" });
  });

  it("surfaces the client-safe 'Personas not found' validation error as 400", async () => {
    const res = await post({ deactivateIds: ["persona-does-not-exist"] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Personas not found");
    expect(body.error).toContain("persona-does-not-exist");
  });
});
