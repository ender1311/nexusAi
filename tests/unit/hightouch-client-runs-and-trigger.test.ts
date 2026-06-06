// Unit tests for HightouchClient.getSyncRuns() pagination and triggerSync()
// full-resync threading.
//
// Bug 1 (getSyncRuns): the method issued a single `{ limit }` request, so a
// caller asking for >100 runs silently got only the first page (the API caps a
// page at 100). Same single-page truncation class as the listSyncs bug. It must
// page via `hasMore` until it has `limit` runs.
//
// Bug 2 (triggerSync): the "Full resync" toggle in the UI was a no-op — the
// route ignored the body and triggerSync always posted `{}`. triggerSync must
// forward `{ fullResync: true }` when a full resync is requested.

import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { HightouchClient } from "@/lib/hightouch/client";

function makeRuns(count: number, startId = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(startId + i),
    syncId: "s1",
    status: "success" as const,
    startedAt: "2026-01-01T00:00:00Z",
    finishedAt: "2026-01-01T00:05:00Z",
    plannedRows: null,
    completionRatio: 1,
    error: null,
  }));
}

// Mirrors the real API: returns up to `limit` rows and a `hasMore` flag.
function pagedRunsFetch(total: number) {
  return mock(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const page = makeRuns(Math.max(0, Math.min(limit, total - offset)), offset + 1);
    const hasMore = offset + page.length < total;
    return new Response(JSON.stringify({ data: page, hasMore }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("HightouchClient.getSyncRuns() — pagination", () => {
  const client = new HightouchClient("test-key");
  let fetchSpy: ReturnType<typeof mock>;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns in a single request when limit fits one page", async () => {
    fetchSpy = pagedRunsFetch(200);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const runs = await client.getSyncRuns("s1", 20);
    expect(runs).toHaveLength(20);
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });

  it("pages via hasMore when limit exceeds the 100-row page cap", async () => {
    fetchSpy = pagedRunsFetch(500);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const runs = await client.getSyncRuns("s1", 250);
    expect(runs).toHaveLength(250);
    // 100 + 100 + 50 = 250 → three requests.
    expect(fetchSpy.mock.calls).toHaveLength(3);
    const secondUrl = new URL(String(fetchSpy.mock.calls[1]![0]));
    expect(secondUrl.searchParams.get("offset")).toBe("100");
  });

  it("stops early when the server reports no more runs than exist", async () => {
    fetchSpy = pagedRunsFetch(15);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const runs = await client.getSyncRuns("s1", 100);
    expect(runs).toHaveLength(15);
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });

  it("stops when a page returns no data even if hasMore is true", async () => {
    fetchSpy = mock(async () =>
      new Response(JSON.stringify({ data: [], hasMore: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const runs = await client.getSyncRuns("s1", 100);
    expect(runs).toHaveLength(0);
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });
});

describe("HightouchClient.triggerSync() — full resync threading", () => {
  const client = new HightouchClient("test-key");
  let fetchSpy: ReturnType<typeof mock>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = mock(async () =>
      new Response(JSON.stringify({ id: "run-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts an empty body for an incremental run", async () => {
    await client.triggerSync("s1");
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({});
  });

  it("posts { fullResync: true } when a full resync is requested", async () => {
    await client.triggerSync("s1", true);
    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual({ fullResync: true });
  });
});
