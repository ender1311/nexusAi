// tests/regression/agent-audience-preview-no-pii.test.ts
//
// REGRESSION (PII removal): the agent detail "Next Send Preview" / "Segment
// Member Preview" tables used to render end-user Name (attributes.first_name)
// and Email (attributes.email) columns. End-user PII must never be exposed in
// the app UI (it stays in the DB only). To guarantee PII can't reach the client
// bundle, getCachedAgentAudienceData() must NOT select the `attributes` JSON
// blob (which carries first_name/email) for its preview rows — it returns only
// externalId + personaId.
//
// A future change that re-adds `attributes` (or any name/email field) to the
// preview select will break here, not silently re-expose PII on the page.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { createPersona, createUser } from "../helpers/builders";
import { getCachedAgentAudienceData } from "@/lib/cache/agents";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: agent audience preview excludes end-user PII", () => {
  it("previewUsers carry only externalId + personaId, never name/email attributes", async () => {
    const persona = await createPersona({ name: "PII Guard Persona" });
    await createUser("pii-user-1", {
      personaId: persona.id,
      attributes: { first_name: "Alice", email: "alice@example.com" },
    });
    await createUser("pii-user-2", {
      personaId: persona.id,
      attributes: { first_name: "Bob", email: "bob@example.com" },
    });

    const { previewUsers } = await getCachedAgentAudienceData("agent-pii-guard", [persona.id]);

    expect(previewUsers.length).toBe(2);
    for (const u of previewUsers) {
      // Only the two non-PII keys should be present.
      expect(Object.keys(u).sort()).toEqual(["externalId", "personaId"]);
      const serialized = JSON.stringify(u);
      expect(serialized).not.toContain("attributes");
      expect(serialized).not.toContain("first_name");
      expect(serialized).not.toContain("Alice");
      expect(serialized).not.toContain("Bob");
      expect(serialized).not.toContain("@example.com");
    }
  });
});
