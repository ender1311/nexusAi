import { describe, expect, it } from "bun:test";
import { CONNECTORS, CONTENT_SOURCE_STATUS, contentSources, senders, sources } from "@site/content/connectors";

describe("connectors", () => {
  it("marks only braze, hightouch and nexus-library as live", () => {
    expect(CONNECTORS.filter((c) => c.status === "live").map((c) => c.id).sort()).toEqual(["braze", "hightouch", "nexus-library"]);
  });
  it("lists every spec connector exactly once", () => {
    expect(sources().map((c) => c.id)).toEqual(["segment", "snowflake", "bigquery", "hightouch", "csv"]);
    expect(senders().map((c) => c.id)).toEqual(["braze", "iterable", "customerio", "onesignal", "twilio", "sendgrid"]);
    expect(new Set(CONNECTORS.map((c) => c.id)).size).toBe(CONNECTORS.length);
  });
  it("lists the content sources, with status taken from CONTENT_SOURCE_STATUS", () => {
    expect(contentSources().map((c) => c.id)).toEqual(["contentful", "sanity", "generic-json", "braze-catalog", "nexus-library"]);
    expect(contentSources().find((c) => c.id === "nexus-library")?.status).toBe("live");
    for (const c of contentSources()) expect(c.status).toBe(CONTENT_SOURCE_STATUS[c.id as keyof typeof CONTENT_SOURCE_STATUS]);
  });
  it("keeps content connectors out of the source and sender lists", () => {
    const ids = [...sources(), ...senders()].map((c) => c.id);
    for (const c of contentSources()) expect(ids).not.toContain(c.id);
  });
});
