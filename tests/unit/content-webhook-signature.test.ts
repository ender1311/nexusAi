import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import {
  verifyContentfulSignature, verifyContentWebhook, verifySanitySignature, verifyWebhookSignature,
} from "@/connectors/content/webhook-signature";

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

// Golden vectors produced by the official toolkits (@contentful/node-apps-toolkit 4.1.0 signRequest,
// @sanity/webhook 4.0.4 encodeSignatureHeader) with this 64-char secret, so the scheme is pinned to
// what the senders really emit rather than to our own formula.
const SECRET = "k".repeat(64);
const T0 = 1760000000000;
const MIN = 60_000;

describe("verifySanitySignature", () => {
  const sBody = '{"_id":"a"}';
  const header = "t=1760000000000,v1=oaAPFp73OHrkcsbCJ2xJu0ZpT07Ll3hiY6RwAfI0IM8";
  it("accepts the official signature inside the window", () => {
    expect(verifySanitySignature(sBody, header, SECRET, () => T0)).toBe(true);
    expect(verifySanitySignature(sBody, header, SECRET, () => T0 + 4 * MIN)).toBe(true);
  });
  it("rejects tampered body, wrong secret, missing/garbled header, and stale or future timestamps", () => {
    expect(verifySanitySignature(`${sBody} `, header, SECRET, () => T0)).toBe(false);
    expect(verifySanitySignature(sBody, header, "x".repeat(64), () => T0)).toBe(false);
    expect(verifySanitySignature(sBody, null, SECRET, () => T0)).toBe(false);
    expect(verifySanitySignature(sBody, "garbage", SECRET, () => T0)).toBe(false);
    expect(verifySanitySignature(sBody, header, SECRET, () => T0 + 6 * MIN)).toBe(false);
    expect(verifySanitySignature(sBody, header, SECRET, () => T0 - 6 * MIN)).toBe(false);
  });
});

describe("verifyContentfulSignature", () => {
  const cBody = '{"sys":{"id":"e1"}}';
  const path = "/api/content/webhook/contentful";
  const headers = () =>
    new Headers({
      "content-type": "application/vnd.contentful.management.v1+json",
      "x-contentful-topic": "ContentManagement.Entry.publish",
      "x-contentful-signature": "b783090db8d6b248d185781de8a55f5551a4755f1bae884f1c79d6ee569fcf60",
      "x-contentful-signed-headers": "content-type,x-contentful-signed-headers,x-contentful-timestamp,x-contentful-topic",
      "x-contentful-timestamp": String(T0),
    });
  const req = (over: Partial<{ method: string; path: string; headers: Headers; rawBody: string }> = {}) =>
    ({ method: "POST", path, headers: headers(), rawBody: cBody, ...over });

  it("accepts the official signature inside the window", () => {
    expect(verifyContentfulSignature(req(), SECRET, () => T0)).toBe(true);
    expect(verifyContentfulSignature(req(), SECRET, () => T0 + 4 * MIN)).toBe(true);
  });
  it("rejects tampered body, signed header, path or method, and a wrong secret", () => {
    expect(verifyContentfulSignature(req({ rawBody: `${cBody} ` }), SECRET, () => T0)).toBe(false);
    const h = headers(); h.set("x-contentful-topic", "ContentManagement.Entry.delete");
    expect(verifyContentfulSignature(req({ headers: h }), SECRET, () => T0)).toBe(false);
    expect(verifyContentfulSignature(req({ path: "/api/content/webhook/sanity" }), SECRET, () => T0)).toBe(false);
    expect(verifyContentfulSignature(req({ method: "PUT" }), SECRET, () => T0)).toBe(false);
    expect(verifyContentfulSignature(req(), "x".repeat(64), () => T0)).toBe(false);
  });
  it("rejects missing headers and stale timestamps", () => {
    for (const name of ["x-contentful-signature", "x-contentful-signed-headers", "x-contentful-timestamp"]) {
      const h = headers(); h.delete(name);
      expect(verifyContentfulSignature(req({ headers: h }), SECRET, () => T0)).toBe(false);
    }
    expect(verifyContentfulSignature(req(), SECRET, () => T0 + 6 * MIN)).toBe(false);
    expect(verifyContentfulSignature(req(), undefined, () => T0)).toBe(false);
  });
});

describe("verifyContentWebhook", () => {
  const body = '{"x":1}';
  const nexus = createHmac("sha256", "s3cret").update(body).digest("hex");
  const parts = (h: Record<string, string>) => ({ method: "POST", path: "/p", headers: new Headers(h), rawBody: body });
  it("accepts the Nexus hex HMAC for every source", () => {
    for (const source of ["contentful", "sanity", "generic-json"]) {
      expect(verifyContentWebhook(source, parts({ "x-nexus-signature": nexus }), "s3cret")).toBe(true);
    }
  });
  it("does not let a failing native header fall back to another scheme, or cross schemes between sources", () => {
    expect(verifyContentWebhook("contentful", parts({ "x-contentful-signature": nexus }), "s3cret")).toBe(false);
    expect(verifyContentWebhook("generic-json", parts({ "x-contentful-signature": nexus }), "s3cret")).toBe(false);
    expect(verifyContentWebhook("sanity", parts({}), "s3cret")).toBe(false);
  });
});
