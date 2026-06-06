// Regression: the data-ingest "Push Test Event" form always showed
// "processed: 0". The ingest endpoint returns { received, matched, ... } but the
// push-event proxy forwarded the body verbatim under { data }, while the form
// reads { processed, matched }. `received` was never mapped to `processed`. The
// proxy must map received -> processed (and pass errors through untouched).

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

const ingestResult: { status: number; body: Record<string, unknown> } = {
  status: 200,
  body: { ok: true, received: 5, matched: 3, unmatched: 2 },
};

mock.module("@/lib/auth", () => ({
  requireAdmin: async () => null,
}));

mock.module("@/app/api/ingest/events/route", () => ({
  POST: async () => NextResponse.json(ingestResult.body, { status: ingestResult.status }),
}));

const { POST } = await import("@/app/api/data-ingest/push-event/route");

function req() {
  return new NextRequest("http://localhost/api/data-ingest/push-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      external_user_id: "user-1",
      event_name: "session_start",
      occurred_at: "2026-06-06T00:00:00Z",
      properties: {},
    }),
  });
}

beforeEach(() => {
  ingestResult.status = 200;
  ingestResult.body = { ok: true, received: 5, matched: 3, unmatched: 2 };
});
afterEach(() => {
  ingestResult.status = 200;
  ingestResult.body = { ok: true, received: 5, matched: 3, unmatched: 2 };
});

describe("push-event proxy maps received -> processed", () => {
  it("returns { data: { processed, matched } } from the ingest result", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { processed: number; matched: number } };
    expect(body.data).toEqual({ processed: 5, matched: 3 });
  });

  it("passes an ingest error through with its status and no data wrapper", async () => {
    ingestResult.status = 400;
    ingestResult.body = { error: "bad event" };
    const res = await POST(req());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; data?: unknown };
    expect(body.error).toBe("bad event");
    expect(body.data).toBeUndefined();
  });
});
