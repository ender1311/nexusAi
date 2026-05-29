import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { POST as createAgent } from "@/app/api/agents/route";

// Regression: agent-creation wizard dropped picked push verses.
// In Step 3 the push channel uses TemplatePicker, whose selection lived only
// in its internal state. Picked verses were only committed to form.messages if
// the user clicked the inner "Add Message"; hitting the wizard's "Next" lost
// them, so the new agent had 0 variants. The wizard now auto-commits the
// picker's pending selection on "Next" (TemplatePicker.commitPending()).
//
// This test guards the end-to-end contract that commit relies on: a payload
// shaped exactly like addMessageFromTemplate's output must persist every
// variant the user picked.

async function apiPost(body: unknown) {
  const req = buildRequest("POST", body);
  return createAgent(req as NextRequest);
}

describe("POST /api/agents — wizard template messages persist", () => {
  beforeEach(async () => {
    await truncateAll();
  });
  afterEach(async () => {
    await truncateAll();
  });

  it("persists all picked push verses as variants", async () => {
    // Mirrors the shape produced by addMessageFromTemplate in the wizard:
    // emptyVariant() defaults plus the template fields.
    const pickedVerse = (name: string, body: string, deeplink: string) => ({
      name,
      body,
      subject: "",
      cta: "",
      title: name,
      deeplink,
      iconImageUrl: "",
      preferredHour: null,
      preferredDayOfWeek: null,
      frequencyCapOverride: null,
      sourceTemplateId: undefined,
    });

    const res = await apiPost({
      name: "Verse Agent",
      funnelStage: "wau",
      messages: [
        {
          name: "Reader — Specific Verse",
          channel: "push",
          variants: [
            pickedVerse("Do Not Fear (Isaiah 41:10)", "Do not fear, for I am with you…", "youversion://bible?reference=ISA.41.10"),
            pickedVerse("The Lord Is My Shepherd (Psalm 23)", "The Lord is my shepherd…", "youversion://bible?reference=PSA.23.1"),
            pickedVerse("Be Strong (Joshua 1:9)", "Be strong and courageous…", "youversion://bible?reference=JOS.1.9"),
          ],
        },
      ],
    });

    expect(res.status).toBe(201);
    const agent = await res.json();

    const variants = await prisma.messageVariant.findMany({
      where: { message: { agentId: agent.id } },
    });
    expect(variants).toHaveLength(3);

    const names = variants.map((v) => v.name).sort();
    expect(names).toEqual([
      "Be Strong (Joshua 1:9)",
      "Do Not Fear (Isaiah 41:10)",
      "The Lord Is My Shepherd (Psalm 23)",
    ]);
  });
});
