// Regression: agent-level deeplinkOverride must win over per-variant deeplink at
// send time, collapsing all variants to one link. Guards the cron variantMeta
// build (src/app/api/cron/select-and-send/route.ts ~line 577).
import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "@/lib/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

describe("deeplinkOverride precedence (regression)", () => {
  it("override replaces every variant's own deeplink in the resolved link set", async () => {
    const override = "https://www.bible.com/verse-of-the-day";
    const agent = await createAgent({ name: `dlreg-${Date.now()}`, deeplinkOverride: override });
    const msg = await createMessage(agent.id, { channel: "push" });
    await createVariant(msg.id, { name: "A", title: "t", body: "b", deeplink: "youversion://home" });
    await createVariant(msg.id, { name: "B", title: "t", body: "b", deeplink: "youversion://discover" });

    const fresh = await prisma.agent.findUnique({
      where: { id: agent.id },
      include: { messages: { include: { variants: true } } },
    });
    const resolved = fresh!.messages.flatMap((m) =>
      m.variants.map((v) => fresh!.deeplinkOverride ?? v.deeplink ?? null),
    );
    expect(new Set(resolved)).toEqual(new Set([override]));
  });
});

afterAll(async () => {
  await prisma.agent.deleteMany({ where: { name: { startsWith: "dlreg-" } } });
});
