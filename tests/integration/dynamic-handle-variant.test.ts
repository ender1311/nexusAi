// tests/integration/dynamic-handle-variant.test.ts
// End-to-end wiring for dynamic-handle giving variants:
//   library template (with actionFeatures) → agent clone (picker drops actionFeatures)
//   → sync-template-variants propagation → send-grouping resolves the per-user ask.
// The clone only becomes a working dynamic-handle variant AFTER the sync propagates
// subcategory + actionFeatures, so this guards that pipeline.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { syncClonesFromTemplate } from "@/lib/services/template-service";
import { TEMPLATE_COPY_FIELDS } from "@/lib/engine/template-sync";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import {
  DEFAULT_HANDLE_USD,
  isGivingHandleStrategy,
  isGivingFrequency,
} from "@/lib/engine/giving-link";

beforeEach(async () => {
  await truncateAll();
});
afterEach(async () => {
  await truncateAll();
});

// Mirrors the cron's actionFeatures readers (deriveGivingStrategy/Frequency/DefaultUsd)
// so the test builds the same VariantMeta the send path would.
function metaFromVariant(v: {
  body: string;
  title: string | null;
  deeplink: string | null;
  subcategory: string | null;
  actionFeatures: unknown;
}): VariantMeta {
  const af = (v.actionFeatures ?? {}) as Record<string, unknown>;
  const isDynamic = v.subcategory === "dynamic-handle";
  const rawStrategy = af["givingHandleStrategy"];
  const rawFreq = af["givingFrequency"];
  const rawDefault = Number(af["givingHandleDefaultUsd"]);
  return {
    channel: "push",
    body: v.body,
    title: v.title,
    cta: null,
    deeplink: v.deeplink,
    brazeCampaignId: null,
    brazeVariantId: null,
    givingHandleStrategy: isDynamic ? (isGivingHandleStrategy(rawStrategy) ? rawStrategy : "blend") : null,
    givingFrequency: isGivingFrequency(rawFreq) ? rawFreq : "monthly",
    givingHandleDefaultUsd: isFinite(rawDefault) && rawDefault > 0 ? rawDefault : DEFAULT_HANDLE_USD,
    iconImageUrl: null,
  };
}

describe("dynamic-handle variant pipeline", () => {
  it("propagates actionFeatures + subcategory from template to an agent clone", async () => {
    // 1. Library template with the never-giver opening-ask config.
    const templateHolder = await createAgent({ name: "Library Holder" });
    const libMessage = await createMessage(templateHolder.id, { channel: "push" });
    const template = await createVariant(libMessage.id, {
      name: "Dynamic Handle — Sower Ask $50",
      title: "Become a Sower",
      body: "Give {{ask}} a month",
      deeplink: null,
      category: "giving",
      subcategory: "dynamic-handle",
      actionFeatures: {
        givingHandleStrategy: "blend",
        givingFrequency: "monthly",
        givingHandleDefaultUsd: 50,
      },
    });

    // 2. Agent clone as the picker creates it: sourceTemplateId set, but
    //    subcategory/actionFeatures NOT copied at attach time.
    const agent = await createAgent({});
    const agentMessage = await createMessage(agent.id, { channel: "push" });
    const clone = await createVariant(agentMessage.id, {
      name: "Dynamic Handle — Sower Ask $50",
      title: "Become a Sower",
      body: "Give {{ask}} a month",
      sourceTemplateId: template.id,
    });

    const beforeSync = await prisma.messageVariant.findUniqueOrThrow({ where: { id: clone.id } });
    expect(beforeSync.subcategory).toBeNull();
    expect(beforeSync.actionFeatures).toBeNull();

    // 3. The sync-template-variants cron propagates the synced fields.
    const copyData = Object.fromEntries(
      TEMPLATE_COPY_FIELDS.map((f) => [f, (template as Record<string, unknown>)[f]]),
    );
    const updated = await syncClonesFromTemplate(template.id, copyData);
    expect(updated).toBe(1);

    // 4. The clone is now a working dynamic-handle variant.
    const afterSync = await prisma.messageVariant.findUniqueOrThrow({ where: { id: clone.id } });
    expect(afterSync.subcategory).toBe("dynamic-handle");
    const af = afterSync.actionFeatures as Record<string, unknown>;
    expect(af.givingHandleDefaultUsd).toBe(50);
    expect(af.givingHandleStrategy).toBe("blend");
  });

  it("send-grouping resolves a never-giver to the clone's per-variant default ask", async () => {
    const templateHolder = await createAgent({ name: "Library Holder" });
    const libMessage = await createMessage(templateHolder.id, { channel: "push" });
    const template = await createVariant(libMessage.id, {
      name: "Dynamic Handle — Sower Ask $50",
      title: "Become a Sower",
      body: "Give {{ask}} a month",
      deeplink: null,
      category: "giving",
      subcategory: "dynamic-handle",
      actionFeatures: {
        givingHandleStrategy: "blend",
        givingFrequency: "monthly",
        givingHandleDefaultUsd: 50,
      },
    });
    const agent = await createAgent({});
    const agentMessage = await createMessage(agent.id, { channel: "push" });
    const clone = await createVariant(agentMessage.id, {
      name: "Dynamic Handle — Sower Ask $50",
      title: "Become a Sower",
      body: "Give {{ask}} a month",
      sourceTemplateId: template.id,
    });
    const copyData = Object.fromEntries(
      TEMPLATE_COPY_FIELDS.map((f) => [f, (template as Record<string, unknown>)[f]]),
    );
    await syncClonesFromTemplate(template.id, copyData);

    const synced = await prisma.messageVariant.findUniqueOrThrow({ where: { id: clone.id } });
    const variantMeta = new Map<string, VariantMeta>([[synced.id, metaFromVariant(synced)]]);

    // Never-giver: no gift history → falls to the variant's $50 default.
    const groups = groupDecisionsByVariant(
      [{ user: { externalId: "u1", brazeId: null, attributes: {} }, variantId: synced.id, scheduledAt: new Date("2026-06-14T12:00:00Z"), inLocalTime: false }],
      variantMeta,
      new Map([["u1", "d1"]]),
    );
    const g = Object.values(groups)[0];
    expect(g.deeplink).toContain("amount=50");
    expect(g.deeplink).toContain("frequency=monthly");
    expect(g.body).toBe("Give $50 a month");
  });
});
