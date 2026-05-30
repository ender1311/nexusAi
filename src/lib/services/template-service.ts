import { prisma } from "@/lib/db";
import { TEMPLATE_COPY_FIELDS } from "@/lib/engine/template-sync";

/**
 * Propagates copy fields from a template variant to all its clones.
 * Looks up clones by sourceTemplateId. Uses updateMany for compatibility
 * with the Neon HTTP adapter (no interactive transaction needed).
 * Returns the number of clones updated.
 */
export async function syncClonesFromTemplate(
  templateId: string,
  copyData: Record<string, unknown>
): Promise<number> {
  const clones = await prisma.messageVariant.findMany({
    where: { sourceTemplateId: templateId },
    select: { id: true },
  });
  if (clones.length === 0) return 0;

  const syncFields = Object.fromEntries(
    TEMPLATE_COPY_FIELDS.map((f) => [f, copyData[f] ?? null])
  );

  await prisma.messageVariant.updateMany({
    where: { sourceTemplateId: templateId },
    data: syncFields,
  });

  return clones.length;
}
