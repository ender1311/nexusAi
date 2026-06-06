// Unit tests for HightouchClient.listSyncs() pagination.
// Bug: the method paged on a `pagination.total` field, but the Hightouch v1
// /syncs endpoint actually returns `{ data, hasMore }`. With no `total` present,
// the loop stopped after one full page (100), silently dropping every sync
// beyond it. In production (127 syncs) this hid `all-givers-to-nexus` and ~26
// others from the Data Ingest view, so they couldn't be triggered.

import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import { HightouchClient } from "@/lib/hightouch/client";

function makeSyncs(count: number, startId = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(startId + i),
    name: null,
    slug: `sync-${startId + i}`,
    status: "success" as const,
    primaryKey: "id",
    modelId: "m1",
    destinationId: "d1",
    schedule: null,
    lastRunAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    configuration: {},
  }));
}

// Mirrors the real API: returns up to `limit` rows and a `hasMore` flag.
function pagedFetch(total: number) {
  return mock(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const page = makeSyncs(Math.max(0, Math.min(limit, total - offset)), offset + 1);
    const hasMore = offset + page.length < total;
    return new Response(JSON.stringify({ data: page, hasMore }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("HightouchClient.listSyncs() — pagination", () => {
  const client = new HightouchClient("test-key");

  let fetchSpy: ReturnType<typeof mock>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = pagedFetch(127);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches all pages and returns 127 syncs when total > page size", async () => {
    const syncs = await client.listSyncs();
    expect(syncs).toHaveLength(127);
    // Pages at offsets 0 and 100.
    expect(fetchSpy.mock.calls).toHaveLength(2);
  });

  it("keeps paging when a full page (100) comes back with hasMore=true", async () => {
    // The exact production failure: page 0 returns exactly PAGE rows. The old
    // total-based logic broke here; hasMore must drive the next fetch.
    fetchSpy = pagedFetch(100 + 27);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const syncs = await client.listSyncs();
    expect(syncs).toHaveLength(127);
    expect(fetchSpy.mock.calls).toHaveLength(2);
    // The second request must be issued at offset 100.
    const secondUrl = new URL(String(fetchSpy.mock.calls[1]![0]));
    expect(secondUrl.searchParams.get("offset")).toBe("100");
  });

  it("stops after one request when hasMore is false", async () => {
    fetchSpy = pagedFetch(50);
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const syncs = await client.listSyncs();
    expect(syncs).toHaveLength(50);
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });

  it("stops when a page returns no data even if hasMore is true", async () => {
    // Guard against an infinite loop if the API ever returns hasMore=true with an
    // empty page.
    fetchSpy = mock(async () =>
      new Response(JSON.stringify({ data: [], hasMore: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const syncs = await client.listSyncs();
    expect(syncs).toHaveLength(0);
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });

  it("throws on non-OK response", async () => {
    fetchSpy = mock(async () => new Response("", { status: 401 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(client.listSyncs()).rejects.toThrow("Hightouch listSyncs failed: 401");
  });
});
