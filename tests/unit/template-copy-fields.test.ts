/**
 * Guards the exact contents of TEMPLATE_COPY_FIELDS.
 *
 * This list determines what syncs from library templates to agent clones.
 * If a field is added or removed, existing agent copies will behave differently.
 * Any change to this constant should be intentional and reviewed carefully.
 */
import { describe, expect, it } from "bun:test";
import { TEMPLATE_COPY_FIELDS } from "@/lib/engine/template-sync";

describe("TEMPLATE_COPY_FIELDS", () => {
  it("contains exactly the expected fields in any order", () => {
    const expected = new Set([
      "title",
      "body",
      "deeplink",
      "cta",
      "category",
      "subcategory",
      "iconImageUrl",
      "status",
      "actionFeatures",
    ]);

    const actual = new Set<string>(TEMPLATE_COPY_FIELDS);
    expect(actual).toEqual(expected);
  });

  it("includes status (pausing a library template must propagate to clones)", () => {
    expect(TEMPLATE_COPY_FIELDS).toContain("status");
  });

  it("includes subcategory (category metadata must stay in sync)", () => {
    expect(TEMPLATE_COPY_FIELDS).toContain("subcategory");
  });

  it("includes iconImageUrl (image changes must propagate)", () => {
    expect(TEMPLATE_COPY_FIELDS).toContain("iconImageUrl");
  });

  it("does NOT include brazeVariantId (clone-owned, set by Braze registration)", () => {
    expect(TEMPLATE_COPY_FIELDS).not.toContain("brazeVariantId");
  });

  it("does NOT include sourceTemplateId (structural field, never overwritten)", () => {
    expect(TEMPLATE_COPY_FIELDS).not.toContain("sourceTemplateId");
  });

  it("does NOT include name (clones may have distinct names)", () => {
    expect(TEMPLATE_COPY_FIELDS).not.toContain("name");
  });
});

