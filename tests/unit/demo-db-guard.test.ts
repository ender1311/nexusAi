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
});
