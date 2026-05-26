// Unit tests for HightouchClient.listSyncs() pagination.
// Previously the method fetched only the first page, silently dropping syncs
// beyond the default page limit (100). With 124 total syncs in production,
// ~24 Nexus syncs were invisible in the Data Ingest view.

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

describe("HightouchClient.listSyncs() — pagination", () => {
  const client = new HightouchClient("test-key");

  let fetchSpy: ReturnType<typeof mock>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchSpy = mock(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit  = Number(url.searchParams.get("limit")  ?? "100");
      const total  = 124;
      const page   = makeSyncs(Math.min(limit, total - offset), offset + 1);
      return new Response(JSON.stringify({ data: page, pagination: { total } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches all pages and returns 124 syncs when total > page size", async () => {
    const syncs = await client.listSyncs();
    expect(syncs).toHaveLength(124);
    // Should have made two requests (pages 0 and 100)
    expect(fetchSpy.mock.calls).toHaveLength(2);
  });

  it("stops after one request when total fits in a single page", async () => {
    fetchSpy = mock(async () =>
      new Response(JSON.stringify({ data: makeSyncs(50), pagination: { total: 50 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const syncs = await client.listSyncs();
    expect(syncs).toHaveLength(50);
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });

  it("handles API without pagination field by stopping when data < page size", async () => {
    // API returns no pagination key — fallback: stop when data.length < PAGE
    fetchSpy = mock(async () =>
      new Response(JSON.stringify({ data: makeSyncs(75) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const syncs = await client.listSyncs();
    expect(syncs).toHaveLength(75);
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });

  it("throws on non-OK response", async () => {
    fetchSpy = mock(async () => new Response("", { status: 401 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(client.listSyncs()).rejects.toThrow("Hightouch listSyncs failed: 401");
  });
});
