import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BrazeClient } from "@/lib/braze/client";

// Regression: BrazeClient.get() issued a fetch with no AbortController, so a
// hung Braze endpoint would block the caller indefinitely (post() already had a
// 10s timeout). The fix adds an internal 10s timeout AND threads an optional
// caller AbortSignal so request-scoped cancellation propagates. This test pins
// that contract: every get() passes an AbortSignal to fetch, query params are
// appended, and a caller's abort propagates to the underlying request.

let lastUrl: string;
let lastInit: RequestInit | undefined;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  lastUrl = "";
  lastInit = undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    lastUrl = String(url);
    lastInit = init;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("BrazeClient.get() timeout + signal contract", () => {
  const client = new BrazeClient("test-key", "https://rest.example.com");

  it("passes an AbortSignal to fetch even when no caller signal is given", async () => {
    await client.get("/campaigns/list");
    expect(lastInit?.signal).toBeInstanceOf(AbortSignal);
    expect(lastInit?.method).toBe("GET");
  });

  it("appends params to the query string", async () => {
    await client.get("/campaigns/data_series", { campaign_id: "abc", length: 7 });
    expect(lastUrl).toContain("campaign_id=abc");
    expect(lastUrl).toContain("length=7");
  });

  it("aborts the request signal when the caller's signal fires", async () => {
    const controller = new AbortController();
    await client.get("/campaigns/list", {}, controller.signal);
    const signal = lastInit?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it("aborts immediately when the caller's signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await client.get("/campaigns/list", {}, controller.signal);
    const signal = lastInit?.signal as AbortSignal;
    expect(signal.aborted).toBe(true);
  });
});
