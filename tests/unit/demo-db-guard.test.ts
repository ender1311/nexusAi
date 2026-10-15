import { describe, expect, it } from "bun:test";
import { assertDemoDatabase } from "../../scripts/lib/demo-db-guard";

describe("assertDemoDatabase", () => {
  it("accepts the demo endpoint", () => {
    const url = "postgresql://u:p@ep-orange-star-b8ujtvot-pooler.c-14.us-east-1.aws.neon.tech/neondb?sslmode=require";
    expect(assertDemoDatabase(url)).toBe(url);
  });
  it("rejects anything else, including a missing URL and a lookalike in the path", () => {
    expect(() => assertDemoDatabase(undefined)).toThrow(/DEMO_DATABASE_URL/);
    expect(() => assertDemoDatabase("postgresql://u:p@ep-old-surf-a4p5os6s.us-east-1.aws.neon.tech/neondb")).toThrow(/not the demo database/);
    expect(() => assertDemoDatabase("postgresql://u:p@localhost:5432/ep-orange-star-b8ujtvot")).toThrow(/not the demo database/);
  });
  it("rejects a host that merely starts with the marker", () => {
    expect(() => assertDemoDatabase("postgresql://u:p@ep-orange-star-b8ujtvotX.us-east-1.aws.neon.tech/neondb")).toThrow(/not the demo database/);
  });
  it("rejects a non-neon suffix", () => {
    expect(() => assertDemoDatabase("postgresql://u:p@ep-orange-star-b8ujtvot.evil.com/neondb")).toThrow(/not the demo database/);
  });
  it("rejects a host or hostaddr override param", () => {
    const base = "postgresql://u:p@ep-orange-star-b8ujtvot-pooler.c-14.us-east-1.aws.neon.tech/neondb";
    expect(() => assertDemoDatabase(`${base}?host=prod.example.com`)).toThrow(/host/);
    expect(() => assertDemoDatabase(`${base}?hostaddr=10.0.0.1`)).toThrow(/host/);
  });
  it("throws a friendly error for a malformed URL", () => {
    expect(() => assertDemoDatabase("not a url")).toThrow(/not a valid connection string/);
  });
});
