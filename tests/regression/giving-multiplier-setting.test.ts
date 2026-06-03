/**
 * Regression / contract: Settings API must round-trip the dynamic-handle
 * dollars→Bibles multiplier, and the persisted value must drive the bibles math.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { POST, GET } from "@/app/api/settings/route";
import { parseMultiplier, computeBibles } from "@/lib/engine/giving-copy";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("settings API: giving_dollars_to_bibles_multiplier", () => {
  it("saves and retrieves the multiplier", async () => {
    const postReq = new NextRequest("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ giving_dollars_to_bibles_multiplier: "30" }),
    });
    expect((await POST(postReq)).status).toBe(200);

    const body = (await (await GET()).json()) as Record<string, string>;
    expect(body["giving_dollars_to_bibles_multiplier"]).toBe("30");
  });

  it("persisted multiplier drives amountUsd × multiplier bibles math", async () => {
    const postReq = new NextRequest("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ giving_dollars_to_bibles_multiplier: "24" }),
    });
    await POST(postReq);

    const body = (await (await GET()).json()) as Record<string, string>;
    const multiplier = parseMultiplier(body["giving_dollars_to_bibles_multiplier"]);
    expect(computeBibles(25, multiplier)).toBe(600);
  });

  it("absent key falls back to the default multiplier", async () => {
    const body = (await (await GET()).json()) as Record<string, string>;
    expect(body["giving_dollars_to_bibles_multiplier"]).toBeUndefined();
    expect(parseMultiplier(body["giving_dollars_to_bibles_multiplier"])).toBe(24);
  });
});
