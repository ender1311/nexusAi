export const revalidate = 60;

import { prisma } from "@/lib/db";
import { EMAIL_LIBRARY_AGENT_NAME } from "@/lib/email-categories";
import { EmailLibraryClient, type EmailGroup } from "@/components/email-library/email-library-client";
import type { EmailVariant } from "@/components/email-library/email-card";

export default async function EmailLibraryPage() {
  const agent = await prisma.agent.findFirst({ where: { name: EMAIL_LIBRARY_AGENT_NAME } });

  let groups: EmailGroup[] = [];

  if (agent) {
    const variants = await prisma.messageVariant.findMany({
      where: { message: { agentId: agent.id }, status: { not: "archived" } },
      select: {
        id: true, name: true, subject: true, body: true, deeplink: true,
        cta: true, status: true, category: true, subcategory: true, sortOrder: true,
        translations: {
          select: { language: true, subject: true, status: true },
          where: { status: "active" },
        },
      },
      orderBy: [{ category: "asc" }, { subcategory: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });

    const grouped = new Map<string, Map<string | null, EmailVariant[]>>();
    for (const v of variants) {
      const cat = v.category ?? "uncategorized";
      if (!grouped.has(cat)) grouped.set(cat, new Map());
      const subMap = grouped.get(cat)!;
      const sub = v.subcategory ?? null;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push(v as EmailVariant);
    }
    groups = Array.from(grouped.entries()).flatMap(([c, subMap]) =>
      Array.from(subMap.entries()).map(([s, vs]) => ({ category: c, subcategory: s, variants: vs })),
    );
  }

  const totalVariants = groups.reduce((n, g) => n + g.variants.length, 0);
  const totalLanguages = new Set(
    groups.flatMap((g) => g.variants.flatMap((v) => v.translations.map((t) => t.language)))
  ).size;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalVariants > 0
              ? `${totalVariants} email templates across ${totalLanguages + 1} languages`
              : "Curated email templates from YouVersion campaign history."}
          </p>
        </div>
      </div>
      <EmailLibraryClient groups={groups} />
    </div>
  );
}
