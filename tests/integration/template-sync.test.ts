import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";
import { PATCH } from "@/app/api/variants/[id]/route";
import { buildRequest } from "../helpers/request";

const LIBRARY_AGENT_NAME = "__push-copy-library__";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("PATCH /api/variants/[id]", () => {
  it("returns 404 for unknown variant", async () => {
    const req = buildRequest("PATCH", { title: "new" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("updates a regular variant without touching any clones", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id, { name: "V1", title: "old title" });
    // Create another variant with sourceTemplateId pointing to this one
    // (won't sync because variant is not in library agent)
    const clone = await createVariant(msg.id, {
      name: "Clone",
      title: "clone title",
      sourceTemplateId: variant.id,
    });

    const req = buildRequest("PATCH", { title: "new title" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: variant.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.title).toBe("new title");
    expect(body.clonesUpdated).toBe(0);

    // Clone untouched
    const cloneAfter = await prisma.messageVariant.findUnique({ where: { id: clone.id } });
    expect(cloneAfter!.title).toBe("clone title");
  });

  it("syncs copy fields to clones when template variant is updated", async () => {
    // Library agent
    const libAgent = await createAgent({ name: LIBRARY_AGENT_NAME, status: "draft" });
    const libMsg = await createMessage(libAgent.id);
    const template = await createVariant(libMsg.id, {
      name: "Tmpl",
      title: "original title",
      body: "original body",
      deeplink: "youversion://bible",
      category: "general",
    });

    // Two clones in other agents
    const agent1 = await createAgent({ name: "Agent 1" });
    const msg1 = await createMessage(agent1.id);
    const clone1 = await createVariant(msg1.id, {
      name: "C1",
      title: "original title",
      body: "original body",
      deeplink: "youversion://bible",
      category: "general",
      sourceTemplateId: template.id,
      brazeVariantId: "braze-123",     // should NOT be overwritten
      status: "active",                  // should NOT be overwritten
    });

    const agent2 = await createAgent({ name: "Agent 2" });
    const msg2 = await createMessage(agent2.id);
    const clone2 = await createVariant(msg2.id, {
      name: "C2",
      title: "original title",
      body: "original body",
      sourceTemplateId: template.id,
    });

    // Update the template
    const req = buildRequest("PATCH", {
      title: "updated title",
      body: "updated body",
      deeplink: "youversion://bible?reference=JHN.3.16",
    }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: template.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.title).toBe("updated title");
    expect(body.clonesUpdated).toBe(2);

    // Clones have updated copy fields
    const c1After = await prisma.messageVariant.findUnique({ where: { id: clone1.id } });
    expect(c1After!.title).toBe("updated title");
    expect(c1After!.body).toBe("updated body");
    expect(c1After!.deeplink).toBe("youversion://bible?reference=JHN.3.16");

    // Non-copy fields on clones are untouched
    expect(c1After!.brazeVariantId).toBe("braze-123");
    expect(c1After!.status).toBe("active");

    const c2After = await prisma.messageVariant.findUnique({ where: { id: clone2.id } });
    expect(c2After!.title).toBe("updated title");
  });
});
