import { describe, expect, it } from "bun:test";
import { CONNECTORS, senders, sources } from "@site/content/connectors";

describe("connectors", () => {
  it("marks only braze and hightouch as live", () => {
    expect(CONNECTORS.filter((c) => c.status === "live").map((c) => c.id).sort()).toEqual(["braze", "hightouch"]);
  });
  it("lists every spec connector exactly once", () => {
    expect(sources().map((c) => c.id)).toEqual(["segment", "snowflake", "bigquery", "hightouch", "csv"]);
    expect(senders().map((c) => c.id)).toEqual(["braze", "iterable", "customerio", "onesignal", "twilio", "sendgrid"]);
    expect(new Set(CONNECTORS.map((c) => c.id)).size).toBe(CONNECTORS.length);
  });
});
