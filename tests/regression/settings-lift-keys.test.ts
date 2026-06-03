/**
 * Regression / contract: Settings API must persist and retrieve
 * both new lift-measurement keys without error.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { POST, GET } from "@/app/api/settings/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("settings API: lift measurement keys", () => {
  it("saves baseline_push_open_rate, baseline_conversion_rate and lift_since_date and retrieves them", async () => {
    const postReq = new NextRequest("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseline_push_open_rate: "2.5",
        baseline_conversion_rate: "3.7",
        lift_since_date: "2026-05-12",
      }),
    });
    const postRes = await POST(postReq);
    expect(postRes.status).toBe(200);

    const getRes = await GET();
    const body = await getRes.json() as Record<string, string>;
    expect(body["baseline_push_open_rate"]).toBe("2.5");
    expect(body["baseline_conversion_rate"]).toBe("3.7");
    expect(body["lift_since_date"]).toBe("2026-05-12");
  });

  it("returns defaults gracefully when keys are absent", async () => {
    const getRes = await GET();
    const body = await getRes.json() as Record<string, string>;
    // Keys may be absent — getCachedLiftSettings() falls back to 1.2 / null
    expect(body["baseline_push_open_rate"]).toBeUndefined();
  });
});
