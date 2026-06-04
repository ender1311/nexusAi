import { describe, it, expect } from "bun:test";
import { isKnownAuthHost, resolveAuthOrigin } from "@/lib/auth-origin";

describe("resolveAuthOrigin", () => {
  it("returns an https origin for a known production host", () => {
    expect(resolveAuthOrigin("nexus.youversion.com")).toBe("https://nexus.youversion.com");
  });

  it("returns an https origin for the second registered production host", () => {
    expect(resolveAuthOrigin("nexus-ai-yv.vercel.app")).toBe("https://nexus-ai-yv.vercel.app");
  });

  it("returns an http origin for localhost", () => {
    expect(resolveAuthOrigin("localhost:3000")).toBe("http://localhost:3000");
  });

  it("falls back to the configured URL's origin for an unknown host", () => {
    expect(
      resolveAuthOrigin("preview-xyz.vercel.app", "https://nexus.youversion.com/callback"),
    ).toBe("https://nexus.youversion.com");
  });

  // Regression: WorkOS validates the logout `return_to` against its absolute
  // redirect-URI allowlist. A relative path like "/login" fails validation and
  // renders WorkOS's hosted "Something went wrong / Couldn't sign in" page, so
  // the resolved value must always be an absolute origin we can prepend to a path.
  it("always yields an absolute origin (never a relative path)", () => {
    for (const host of ["nexus.youversion.com", "localhost:3000", "unknown.example"]) {
      const origin = resolveAuthOrigin(host, "https://nexus.youversion.com/callback");
      expect(origin).toMatch(/^https?:\/\//);
    }
  });

  it("tolerates a null/empty host by falling back to the configured origin", () => {
    expect(resolveAuthOrigin(null, "https://nexus.youversion.com/callback")).toBe(
      "https://nexus.youversion.com",
    );
  });
});

describe("isKnownAuthHost", () => {
  it("recognizes registered production hosts and localhost", () => {
    expect(isKnownAuthHost("nexus.youversion.com")).toBe(true);
    expect(isKnownAuthHost("nexus-ai-yv.vercel.app")).toBe(true);
    expect(isKnownAuthHost("localhost:3000")).toBe(true);
    expect(isKnownAuthHost("127.0.0.1:3000")).toBe(true);
  });

  it("rejects unknown hosts", () => {
    expect(isKnownAuthHost("preview-xyz.vercel.app")).toBe(false);
    expect(isKnownAuthHost(null)).toBe(false);
    expect(isKnownAuthHost("")).toBe(false);
  });
});
