import { describe, expect, it } from "bun:test";
import { buildPinnedProperties } from "@/lib/users/pinned-properties";

describe("buildPinnedProperties", () => {
  it("always includes Funnel stage and Persona, using — for null", () => {
    const rows = buildPinnedProperties({ attributes: {}, funnelStage: null, timezone: null, personaName: null });
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map["Funnel stage"]).toBe("—");
    expect(map["Persona"]).toBe("—");
  });

  it("formats booleans as Yes/No and skips missing optional keys", () => {
    const rows = buildPinnedProperties({
      attributes: { email: "a@b.com", name: "Ann", newsletter_push_enabled: true, newsletter_email_enabled: false, language_tag: "en" },
      funnelStage: "wau",
      timezone: "America/New_York",
      personaName: "Engaged",
    });
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map["Email"]).toBe("a@b.com");
    expect(map["Name"]).toBe("Ann");
    expect(map["Newsletter push"]).toBe("Yes");
    expect(map["Newsletter email"]).toBe("No");
    expect(map["Language"]).toBe("en");
    expect(map["Funnel stage"]).toBe("wau");
    expect(map["Persona"]).toBe("Engaged");
    expect(map["Timezone"]).toBe("America/New_York");
    expect(map).not.toHaveProperty("Country"); // country_latest missing → skipped
  });

  it("derives Name from first_name + last_name when name absent", () => {
    const rows = buildPinnedProperties({ attributes: { first_name: "Jo", last_name: "Lee" }, funnelStage: null, timezone: null, personaName: null });
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map["Name"]).toBe("Jo Lee");
  });

  it("preserves the canonical row order", () => {
    const rows = buildPinnedProperties({
      attributes: { email: "a@b.com", name: "Ann", language_tag: "en" },
      funnelStage: "wau", timezone: "UTC", personaName: "P",
    });
    const labels = rows.map((r) => r.label);
    expect(labels.indexOf("Name")).toBeLessThan(labels.indexOf("Email"));
    expect(labels.indexOf("Email")).toBeLessThan(labels.indexOf("Funnel stage"));
    expect(labels.indexOf("Funnel stage")).toBeLessThan(labels.indexOf("Persona"));
  });
});
