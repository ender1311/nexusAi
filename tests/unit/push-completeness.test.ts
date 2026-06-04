import { describe, expect, it } from "bun:test";
import {
  isPushVariantComplete,
  missingPushFields,
} from "@/lib/messages/push-completeness";

describe("isPushVariantComplete", () => {
  it("is true when both title and body are present", () => {
    expect(isPushVariantComplete({ title: "Hi", body: "Body" })).toBe(true);
  });

  it("is false when title is missing", () => {
    expect(isPushVariantComplete({ title: null, body: "Body" })).toBe(false);
    expect(isPushVariantComplete({ body: "Body" })).toBe(false);
  });

  it("is false when body is missing", () => {
    expect(isPushVariantComplete({ title: "Hi", body: null })).toBe(false);
    expect(isPushVariantComplete({ title: "Hi" })).toBe(false);
  });

  it("is false when both are missing", () => {
    expect(isPushVariantComplete({})).toBe(false);
  });

  it("treats whitespace-only strings as missing", () => {
    expect(isPushVariantComplete({ title: "   ", body: "Body" })).toBe(false);
    expect(isPushVariantComplete({ title: "Hi", body: "  \n " })).toBe(false);
  });
});

describe("missingPushFields", () => {
  it("returns an empty array when complete", () => {
    expect(missingPushFields({ title: "Hi", body: "Body" })).toEqual([]);
  });

  it("lists only the missing fields", () => {
    expect(missingPushFields({ title: "", body: "Body" })).toEqual(["title"]);
    expect(missingPushFields({ title: "Hi", body: "" })).toEqual(["body"]);
    expect(missingPushFields({})).toEqual(["title", "body"]);
  });
});
