// tests/regression/ingest-events-invalid-timestamp.test.ts
//
// REGRESSION: /api/ingest/events accepted non-date strings for occurred_at
// (e.g. "yesterday", "invalid"), causing new Date() to silently produce NaN.
// That NaN propagated into recentCutoff (line 114) and windowStart (line 179),
// breaking all time-window calculations and matching every decision in the table.
// Fixed by rejecting events whose occurred_at does not parse to a valid Date.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { buildRequest } from "../helpers/request";
import { POST } from "@/app/api/ingest/events/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

describe("invalid occurred_at timestamp rejection (regression)", () => {
  beforeEach(() => {
    process.env.INGEST_API_KEY = "test_ingest_key";
  });
  afterEach(() => {
    delete process.env.INGEST_API_KEY;
  });

  it("rejects a batch containing a non-date string for occurred_at with 400", async () => {
    const payload = {
      event_id: "reg_ts_001",
      event_name: "plan_started",
      external_user_id: "usr_ts_test",
      occurred_at: "not-a-date",
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/valid ISO 8601/i);
  });

  it("rejects a batch containing 'yesterday' as occurred_at with 400", async () => {
    const payload = {
      event_id: "reg_ts_002",
      event_name: "app_open",
      external_user_id: "usr_ts_test",
      occurred_at: "yesterday",
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/valid ISO 8601/i);
  });

  it("does not reject a request with a valid ISO 8601 occurred_at", async () => {
    const payload = {
      event_id: "reg_ts_003",
      event_name: "plan_started",
      external_user_id: "usr_ts_test",
      occurred_at: "2024-05-10T08:00:00.000Z",
    };

    const res = await POST(buildRequest("POST", payload, AUTH) as NextRequest);
    // Validation passes; route proceeds to DB and may fail there in CI (no test DB),
    // but the response must not be a 400 validation error.
    expect(res.status).not.toBe(400);
  });
});
