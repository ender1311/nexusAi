import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIBRARY_AGENT_NAME, TEMPLATE_COPY_FIELDS, syncClonesFromTemplate } from "@/lib/engine/template-sync";

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token === secret;
}

export async function GET(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templates = await prisma.messageVariant.findMany({
    where: {
      status: "active",
      message: { agent: { name: LIBRARY_AGENT_NAME } },
    },
  });

  let templatesChecked = 0;
  let clonesUpdated = 0;

  for (const template of templates) {
    templatesChecked++;
    const copyData = Object.fromEntries(
      TEMPLATE_COPY_FIELDS.map((f) => [f, (template as Record<string, unknown>)[f]])
    );
    const updated = await syncClonesFromTemplate(template.id, copyData);
    clonesUpdated += updated;
  }

  console.log(`[cron/sync-template-variants] checked=${templatesChecked} clonesUpdated=${clonesUpdated}`);
  return NextResponse.json({ ok: true, templatesChecked, clonesUpdated });
}
