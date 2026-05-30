export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LIBRARY_AGENT_NAME, TEMPLATE_COPY_FIELDS } from "@/lib/engine/template-sync";
import { syncClonesFromTemplate } from "@/lib/services/template-service";

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

  // Fetch ALL library templates regardless of status — paused/retired templates
  // must propagate their status to clones so agent variants stop being sent.
  const templates = await prisma.messageVariant.findMany({
    where: {
      message: { agent: { name: LIBRARY_AGENT_NAME } },
    },
  });

  // Sync all templates in parallel — each call is an updateMany (O(1) round trips per template)
  const results = await Promise.allSettled(
    templates.map((template) => {
      const copyData = Object.fromEntries(
        TEMPLATE_COPY_FIELDS.map((f) => [f, (template as Record<string, unknown>)[f]])
      );
      return syncClonesFromTemplate(template.id, copyData);
    })
  );

  const templatesChecked = templates.length;
  let clonesUpdated = 0;
  let errors = 0;
  for (const r of results) {
    if (r.status === "fulfilled") clonesUpdated += r.value;
    else errors++;
  }

  console.log(`[cron/sync-template-variants] checked=${templatesChecked} clonesUpdated=${clonesUpdated} errors=${errors}`);
  return NextResponse.json({ ok: true, templatesChecked, clonesUpdated, errors });
}
