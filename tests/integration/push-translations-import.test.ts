import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { NextRequest } from "next/server";

// Must mock before importing routes that call requireAdmin()
mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () => Promise.resolve({
    user: { id: "test-user", email: "test@youversion.com", firstName: "Test", lastName: "User" },
    roles: ["admin"], sessionId: "sess1", accessToken: "tok1",
  }),
  signOut: async () => {},
}));

// Import AFTER mock.module so the mock takes effect
const { POST } = await import("@/app/api/push-translations/import/route");
const { prisma, truncateAll } = await import("../helpers/db");
const { createAgent, createMessage } = await import("../helpers/builders");

function form(files: { name: string; body: string }[], fields: Record<string, string> = {}): NextRequest {
  const fd = new FormData();
  for (const f of files) fd.append("files", new File([f.body], f.name, { type: "application/json" }));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new NextRequest("http://test/api/push-translations/import", { method: "POST", body: fd });
}

const en = JSON.stringify({ push_title: "EN", push_message_non_personal: "english copy" });
const es = JSON.stringify({ push_title: "ES", push_message_non_personal: "copia" });
const pt = JSON.stringify({ push_title: "PT", push_message_non_personal: "cópia" });

describe("POST /api/push-translations/import", () => {
  let variantId: string;

  beforeEach(async () => {
    await truncateAll();
    const agent = await createAgent({ name: "Import Test Agent" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await prisma.messageVariant.create({
      data: { messageId: msg.id, name: "V", body: "english copy", title: "EN",
        actionFeatures: { sourceFile: "import-stem-1-en.json" } as object },
    });
    variantId = variant.id;
  });

  afterEach(async () => {
    await prisma.messageVariantTranslation.deleteMany({ where: { messageVariantId: variantId } });
  });

  it("dry-run returns the plan without writing", async () => {
    const res = await POST(form([
      { name: "import-stem-1-en.json", body: en },
      { name: "import-stem-1-es.json", body: es },
      { name: "import-stem-1-pt.json", body: pt },
    ]));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.plan.totals).toMatchObject({ matchedStems: 1, creates: 2 });
    const count = await prisma.messageVariantTranslation.count({ where: { messageVariantId: variantId } });
    expect(count).toBe(0);
  });

  it("commit upserts translation rows (idempotent)", async () => {
    const files = [
      { name: "import-stem-1-en.json", body: en },
      { name: "import-stem-1-es.json", body: es },
    ];
    const res1 = await POST(form(files, { commit: "true" }));
    expect(res1.status).toBe(200);
    const { data: d1 } = await res1.json();
    expect(d1.committed).toMatchObject({ created: 1, updated: 0 });

    const row = await prisma.messageVariantTranslation.findUnique({
      where: { messageVariantId_language: { messageVariantId: variantId, language: "es" } },
    });
    expect(row?.body).toBe("copia");

    const res2 = await POST(form(files, { commit: "true" }));
    const { data: d2 } = await res2.json();
    expect(d2.committed).toMatchObject({ created: 0, updated: 1 });
    const count = await prisma.messageVariantTranslation.count({ where: { messageVariantId: variantId, language: "es" } });
    expect(count).toBe(1);
  });

  it("rejects an empty upload with 400", async () => {
    const res = await POST(form([]));
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(typeof error).toBe("string");
  });
});
