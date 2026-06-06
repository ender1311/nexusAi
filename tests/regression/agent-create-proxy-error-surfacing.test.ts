// Regression: POST /api/agents is a thin proxy to the Hono backend via apiFetch.
// When a launch failed it surfaced a generic 500 to the wizard ("Failed to launch
// agent"), hiding the real cause. Two distinct failure modes were being collapsed:
//   - a backend ApiError (e.g. 400 validation, 409 conflict) lost its status/message
//   - a backend timeout (the Neon WebSocket write-transaction hang) looked like a 500
// The fix maps ApiError through verbatim (status + message) and AbortSignal.timeout
// rejections (DOMException "TimeoutError"/"AbortError") to a friendly 504, falling
// back to handleRouteError only for genuinely unexpected throws.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { buildRequest } from "../helpers/request";

// Controllable behavior for the mocked proxy call.
let behavior: () => Promise<unknown> = async () => ({ id: "a1", name: "Apoc" });

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

mock.module("@/lib/auth", () => ({
  requireAdmin: async () => null, // authorized
}));

mock.module("@/lib/api-client", () => ({
  apiFetch: async () => behavior(),
  ApiError,
}));

const { POST } = await import("@/app/api/agents/route");

function createReq(body: unknown = { name: "Apoc", funnelStage: "wau" }) {
  return buildRequest("POST", body) as unknown as Parameters<typeof POST>[0];
}

afterEach(() => {
  behavior = async () => ({ id: "a1", name: "Apoc" });
});

describe("POST /api/agents — proxy error surfacing", () => {
  it("returns 201 with the created agent on success", async () => {
    behavior = async () => ({ id: "a1", name: "Apoc" });
    const res = await POST(createReq());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: "a1", name: "Apoc" });
  });

  it("preserves a backend ApiError's status and message (does NOT collapse to 500)", async () => {
    behavior = async () => {
      throw new ApiError(409, 'Segment "VIP" is already assigned to agent "Other"');
    };
    const res = await POST(createReq());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('Segment "VIP" is already assigned to agent "Other"');
  });

  it("maps a backend 400 validation error through verbatim", async () => {
    behavior = async () => {
      throw new ApiError(400, "name is required");
    };
    const res = await POST(createReq());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("name is required");
  });

  it("maps an AbortSignal.timeout rejection to a friendly 504", async () => {
    behavior = async () => {
      // AbortSignal.timeout() rejects with a DOMException named "TimeoutError".
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    const res = await POST(createReq());
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toContain("took too long");
  });

  it("falls back to a generic 500 for unexpected throws (no internal detail leaked)", async () => {
    behavior = async () => {
      throw new Error("ECONNREFUSED 10.0.0.1:5432");
    };
    const res = await POST(createReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
    expect(body.error).not.toContain("ECONNREFUSED");
  });
});
