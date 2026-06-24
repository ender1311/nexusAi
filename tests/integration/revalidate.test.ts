// Covers the cache-revalidation auth gate. Secret comparison runs through
// constantTimeEqual (no secret-length leak). The valid-secret cases assert a
// 400 on a missing tag, which exercises the comparison's success path while
// returning before revalidateTag() (which needs a Next request context).

import { describe, it, expect, afterEach } from "bun:test";
import { POST } from "@/app/api/revalidate/route";
import { NextRequest } from "next/server";

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/revalidate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/revalidate auth", () => {
  afterEach(() => {
    delete process.env.REVALIDATE_SECRET;
  });

  it("rejects a wrong secret with 401", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    expect((await POST(req({ tag: "agents", secret: "wrong-secret" }))).status).toBe(401);
  });

  it("rejects a secret of a different length with 401", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    expect((await POST(req({ tag: "agents", secret: "x" }))).status).toBe(401);
  });

  it("fails closed when REVALIDATE_SECRET is unset", async () => {
    delete process.env.REVALIDATE_SECRET;
    expect((await POST(req({ tag: "agents", secret: "anything" }))).status).toBe(401);
  });

  it("accepts the correct secret (400 on missing tag, past the auth gate)", async () => {
    process.env.REVALIDATE_SECRET = "correct-secret";
    const res = await POST(req({ secret: "correct-secret" }));
    expect(res.status).toBe(400);
  });
});
