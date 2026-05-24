import { afterEach, describe, expect, it } from "bun:test";
import { verifyIngestAuth } from "@/lib/ingest-auth";

const originalIngestKey = process.env.INGEST_API_KEY;
const originalHightouchKey = process.env.HIGHTOUCH_API_KEY;

afterEach(() => {
  if (originalIngestKey === undefined) delete process.env.INGEST_API_KEY;
  else process.env.INGEST_API_KEY = originalIngestKey;

  if (originalHightouchKey === undefined) delete process.env.HIGHTOUCH_API_KEY;
  else process.env.HIGHTOUCH_API_KEY = originalHightouchKey;
});

describe("verifyIngestAuth", () => {
  it("accepts bearer auth with INGEST_API_KEY", () => {
    process.env.INGEST_API_KEY = "test-ingest-key";
    delete process.env.HIGHTOUCH_API_KEY;

    const headers = new Headers({ Authorization: "Bearer test-ingest-key" });

    expect(verifyIngestAuth(headers)).toBe(true);
  });

  it("accepts x-hightouch-token when Basic Auth owns the Authorization header", () => {
    process.env.INGEST_API_KEY = "test-ingest-key";
    process.env.HIGHTOUCH_API_KEY = "outbound-hightouch-api-key";

    const headers = new Headers({
      Authorization: "Basic dXNlcjpwYXNz",
      "X-Hightouch-Token": "test-ingest-key",
    });

    expect(verifyIngestAuth(headers)).toBe(true);
  });

  it("rejects requests when no ingest secrets are configured", () => {
    delete process.env.INGEST_API_KEY;
    delete process.env.HIGHTOUCH_API_KEY;

    const headers = new Headers({ Authorization: "Bearer test-ingest-key" });

    expect(verifyIngestAuth(headers)).toBe(false);
  });
});
