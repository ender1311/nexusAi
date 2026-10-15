import { describe, expect, it } from "bun:test";
import { calendlyEmbedUrl } from "@site/lib/leads/calendly-url";

describe("calendlyEmbedUrl", () => {
  it("pre-fills email and company and marks the embed", () => {
    const u = new URL(calendlyEmbedUrl("https://calendly.com/danluk1311/30min", { email: "ana@acme.io", company: "Acme & Co" }));
    expect(u.origin + u.pathname).toBe("https://calendly.com/danluk1311/30min");
    expect(u.searchParams.get("email")).toBe("ana@acme.io");
    expect(u.searchParams.get("a1")).toBe("Acme & Co");
    expect(u.searchParams.get("embed_type")).toBe("Inline");
  });
});
