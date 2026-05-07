export const dynamic = "force-dynamic";

import { BookOpen } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";
import { TemplateCard } from "@/components/push-library/template-card";
import { TemplateFormSheet } from "@/components/push-library/template-form-sheet";

type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
};

type TemplateGroup = {
  category: string;
  subcategory: string | null;
  variants: TemplateVariant[];
};

async function getGroups(): Promise<TemplateGroup[]> {
  const agent = await prisma.agent.findFirst({
    where: { name: LIBRARY_AGENT_NAME },
  });
  if (!agent) return [];

  const variants = await prisma.messageVariant.findMany({
    where: { message: { agentId: agent.id }, status: "active" },
    select: {
      id: true,
      name: true,
      title: true,
      body: true,
      deeplink: true,
      cta: true,
      category: true,
      subcategory: true,
    },
    orderBy: [{ category: "asc" }, { subcategory: "asc" }, { createdAt: "asc" }],
  });

  const grouped = new Map<string, Map<string | null, TemplateVariant[]>>();
  for (const v of variants) {
    const cat = v.category ?? "uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, new Map());
    const subMap = grouped.get(cat)!;
    const sub = v.subcategory ?? null;
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub)!.push(v);
  }

  return Array.from(grouped.entries()).flatMap(([category, subMap]) =>
    Array.from(subMap.entries()).map(([subcategory, vs]) => ({
      category,
      subcategory,
      variants: vs,
    }))
  );
}

export default async function PushLibraryPage() {
  const { isAdmin } = await getAuth();
  const groups = await getGroups();

  const totalVariants = groups.reduce((s, g) => s + g.variants.length, 0);
  const description = `${totalVariants} template${totalVariants !== 1 ? "s" : ""} across ${groups.length} group${groups.length !== 1 ? "s" : ""}`;

  return (
    <>
      <Header title="Push Library" description={description}>
        {isAdmin ? (
          <TemplateFormSheet mode="create">
            <Button size="sm">+ New Template</Button>
          </TemplateFormSheet>
        ) : null}
      </Header>
      <div className="p-4 sm:p-6 space-y-6">
        {groups.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No templates yet</p>
            <p className="text-sm mt-1">Run the seed script to populate the library.</p>
          </div>
        )}
        {groups.map((group) => {
          const sectionKey = `${group.category}-${group.subcategory ?? "none"}`;
          const sectionLabel = group.subcategory
            ? `${group.category} / ${group.subcategory}`
            : group.category;
          return (
            <section key={sectionKey}>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                {sectionLabel}
                <Badge variant="secondary" className="ml-1">
                  {group.variants.length}
                </Badge>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.variants.map((v) => (
                  <TemplateCard key={v.id} variant={v} isAdmin={isAdmin} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
