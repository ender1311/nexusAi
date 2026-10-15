import { describe, expect, it } from "bun:test";
import { resolveIpSalt } from "@site/lib/config";

describe("resolveIpSalt", () => {
  it("uses LEAD_IP_SALT whenever it is set", () => {
    expect(resolveIpSalt({ LEAD_IP_SALT: "s3cret", VERCEL_ENV: "production" })).toBe("s3cret");
    expect(resolveIpSalt({ LEAD_IP_SALT: "s3cret" })).toBe("s3cret");
  });

  it("reports production without LEAD_IP_SALT as misconfigured", () => {
    expect(resolveIpSalt({ VERCEL_ENV: "production" })).toBeNull();
    expect(resolveIpSalt({ VERCEL_ENV: "production", LEAD_IP_SALT: "" })).toBeNull();
  });

  it("falls back to the dev salt outside production", () => {
    expect(resolveIpSalt({})).toBe("nexus-dev-salt");
    expect(resolveIpSalt({ VERCEL_ENV: "preview" })).toBe("nexus-dev-salt");
  });
});
