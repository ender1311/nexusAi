import { describe, it, expect } from "bun:test";
import { maskPersonalization } from "@/lib/messages/personalization";

describe("maskPersonalization", () => {
  it("collapses the EOY blank-check Liquid to the personalized branch with {NAME}", () => {
    const liquid =
      "{% if ${first_name} == blank %}Will you join us?{% else %}{{${first_name} | default: '' }}, will you join us?{% endif %}";
    expect(maskPersonalization(liquid)).toBe("{NAME}, will you join us?");
  });

  it("handles `!= blank` conditionals by keeping the personalized (if) branch", () => {
    const liquid =
      "{% if ${first_name} != blank %}Hey {{${first_name}}}!{% else %}Hey there!{% endif %}";
    expect(maskPersonalization(liquid)).toBe("Hey {NAME}!");
  });

  it("renders a standalone first_name output tag (with default filter) as {NAME}", () => {
    expect(maskPersonalization("{{${first_name} | default: 'friend'}}, welcome")).toBe(
      "{NAME}, welcome",
    );
  });

  it("renders a bare first_name output tag as {NAME}", () => {
    expect(maskPersonalization("Hi {{${first_name}}}")).toBe("Hi {NAME}");
  });

  it("leaves plain copy with no Liquid untouched", () => {
    const plain = "Give a special gift before the end of the year.";
    expect(maskPersonalization(plain)).toBe(plain);
  });

  it("returns null for nullish input so `?? fallback` still works", () => {
    expect(maskPersonalization(null)).toBeNull();
    expect(maskPersonalization(undefined)).toBeNull();
    expect(maskPersonalization("")).toBeNull();
  });

  it("strips any leftover Liquid tags rather than showing raw markup", () => {
    // Conditional with no else branch — keep the literal text, drop the tags.
    expect(maskPersonalization("{% if ${first_name} != blank %}Welcome back{% endif %}")).toBe(
      "Welcome back",
    );
  });
});
