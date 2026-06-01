// Coverage query behind the agent Localization tab (getCachedAgentLanguageCoverage
// in src/lib/cache/agents.ts). The helper is wrapped in unstable_cache, so we
// exercise its exact Prisma query directly: distinct ACTIVE translation languages
// across an agent's push variants, scoped via variant → message → agentId.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createVariantTranslation } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

async function coverageFor(agentId: string): Promise<string[]> {
  const rows = await prisma.messageVariantTranslation.findMany({
    where: { variant: { message: { agentId } }, status: "active" },
    select: { language: true },
    distinct: ["language"],
  });
  return rows.map((r) => r.language);
}

describe("agent language coverage query", () => {
  it("returns distinct active translation languages for the agent's variants", async () => {
    const agent = await createAgent({ name: "Coverage Agent" });
    const message = await createMessage(agent.id);
    const v1 = await createVariant(message.id, { name: "V1" });
    const v2 = await createVariant(message.id, { name: "V2" });

    await createVariantTranslation(v1.id, { language: "es" });
    await createVariantTranslation(v1.id, { language: "pt" });
    // duplicate language on a different variant — must be de-duped
    await createVariantTranslation(v2.id, { language: "es" });

    const langs = await coverageFor(agent.id);
    expect(langs.sort()).toEqual(["es", "pt"]);
  });

  it("excludes inactive translations and other agents' translations", async () => {
    const agent = await createAgent({ name: "Mine" });
    const other = await createAgent({ name: "Theirs" });

    const mineMsg = await createMessage(agent.id);
    const mineVariant = await createVariant(mineMsg.id, { name: "Mine V" });
    await createVariantTranslation(mineVariant.id, { language: "fr" });
    await createVariantTranslation(mineVariant.id, { language: "de", status: "archived" });

    const otherMsg = await createMessage(other.id);
    const otherVariant = await createVariant(otherMsg.id, { name: "Other V" });
    await createVariantTranslation(otherVariant.id, { language: "zh_CN" });

    const langs = await coverageFor(agent.id);
    expect(langs).toEqual(["fr"]);
  });

  it("returns an empty array when the agent has no translations", async () => {
    const agent = await createAgent({ name: "No Translations" });
    const message = await createMessage(agent.id);
    await createVariant(message.id);

    const langs = await coverageFor(agent.id);
    expect(langs).toEqual([]);
  });
});
