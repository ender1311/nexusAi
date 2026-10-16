import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "@/connectors/content/webhook-signature";

const body = '{"sys":{"id":"e1"}}';
const sig = createHmac("sha256", "s3cret").update(body).digest("hex");

describe("verifyWebhookSignature", () => {
  it("accepts the right hex HMAC, with or without a sha256= prefix", () => {
    expect(verifyWebhookSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyWebhookSignature(body, `sha256=${sig}`, "s3cret")).toBe(true);
  });
  it("rejects wrong, missing, or unconfigured", () => {
    expect(verifyWebhookSignature(body, sig.replace(/.$/, "0"), "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, null, "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, sig, undefined)).toBe(false);
    expect(verifyWebhookSignature(`${body} `, sig, "s3cret")).toBe(false);
  });
});
