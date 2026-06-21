import { describe, it, expect } from "bun:test";
import { ingestRateLimited } from "@/lib/rate-limit";

// The ingest rate limiter must FAIL OPEN: off-Vercel (dev/test/CI), with no firewall
// rule, or on any SDK error, it returns false so ingestion is never blocked by it.
describe("ingestRateLimited — fail open", () => {
  it("returns false off-Vercel (no VERCEL env)", async () => {
    const prev = process.env.VERCEL;
    delete process.env.VERCEL;
    const req = new Request("http://localhost/api/ingest/events", { method: "POST" });
    const headers = new Headers({ authorization: "Bearer test-key" });
    expect(await ingestRateLimited(req, headers)).toBe(false);
    if (prev !== undefined) process.env.VERCEL = prev;
  });

  it("never throws when no auth token is present", async () => {
    const req = new Request("http://localhost/api/ingest/events", { method: "POST" });
    expect(await ingestRateLimited(req, new Headers())).toBe(false);
  });
});
