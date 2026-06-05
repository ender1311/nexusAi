// Regression: POST /api/decide awaited decideForUser() with no try/catch, so any
// throw inside the decision engine surfaced as a raw framework 500 instead of the
// `{ error }` contract envelope. External callers (Hightouch/Braze) could not handle
// the response gracefully and internal details could leak. The fix wraps the call in
// try/catch returning `{ error: "Decision service unavailable" }` with status 500.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { buildRequest } from "../helpers/request";

let shouldThrow = false;

mock.module("@/lib/decide", () => ({
  decideForUser: async () => {
    if (shouldThrow) throw new Error("boom from decide engine");
    return { variantId: "v1", channel: "push" };
  },
}));

const { POST } = await import("@/app/api/decide/route");

const AUTH = { Authorization: "Bearer test_decide_key" };

beforeEach(() => {
  process.env.INGEST_API_KEY = "test_decide_key";
});

afterEach(() => {
  delete process.env.INGEST_API_KEY;
  shouldThrow = false;
});

function decideReq(body: unknown) {
  return buildRequest("POST", body, AUTH) as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/decide error envelope", () => {
  it("returns a 500 { error } envelope (not a raw framework 500) when decideForUser throws", async () => {
    shouldThrow = true;
    const res = await POST(decideReq({ agentId: "a1", externalUserId: "u1" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Decision service unavailable");
    expect(body).not.toHaveProperty("data");
  });

  it("still returns a { data } envelope on success", async () => {
    shouldThrow = false;
    const res = await POST(decideReq({ agentId: "a1", externalUserId: "u1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeTruthy();
  });
});
