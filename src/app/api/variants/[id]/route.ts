import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { LIBRARY_AGENT_NAME, TEMPLATE_COPY_FIELDS } from "@/lib/engine/template-sync";
import { syncClonesFromTemplate } from "@/lib/services/template-service";
import { requireLibraryEditor } from "@/lib/auth";
import { getPushTaxonomy } from "@/lib/cache/push-taxonomy";
import { validateVariantTaxonomy } from "@/lib/push-taxonomy";
import { isPushVariantComplete, missingPushFields } from "@/lib/messages/push-completeness";

// Fields an operator is allowed to update via PATCH.
// Excludes id, messageId, sourceTemplateId, createdAt (structural / immutable).
const UPDATABLE_FIELDS = new Set([
  "name", "subject", "body", "cta", "status", "brazeVariantId", "title",
  "iconImageUrl", "deeplink", "preferredHour", "preferredDayOfWeek",
  "frequencyCapOverride", "warmupUntil", "actionFeatures", "category",
  "subcategory", "sortOrder",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const variant = await prisma.messageVariant.findUnique({ where: { id } });
  if (!variant) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  // Only pass whitelisted fields to the update
  const updateData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (UPDATABLE_FIELDS.has(key)) updateData[key] = value;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  if ("category" in updateData || "subcategory" in updateData) {
    const resultingCategory = "category" in updateData ? updateData.category : variant.category;
    const resultingSub = "subcategory" in updateData ? updateData.subcategory : variant.subcategory;
    if (typeof resultingCategory !== "string") {
      return NextResponse.json({ error: "category is required" }, { status: 400 });
    }
    const taxonomy = await getPushTaxonomy();
    const subSlug = typeof resultingSub === "string" && resultingSub.trim() ? resultingSub.trim() : null;
    const valid = validateVariantTaxonomy(taxonomy, resultingCategory, subSlug);
    if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });
  }

  // Channel-aware completeness: a push variant must keep a non-empty title AND
  // body after this edit. Fetched before the update so an incomplete edit is
  // rejected (400) rather than persisted. Single-level include only (Neon).
  const message = await prisma.message.findUnique({
    where: { id: variant.messageId },
    include: { agent: { select: { name: true } } },
  });
  if (message?.channel === "push") {
    const resultingTitle = "title" in updateData ? updateData.title : variant.title;
    const resultingBody = "body" in updateData ? updateData.body : variant.body;
    const candidate = {
      title: typeof resultingTitle === "string" ? resultingTitle : null,
      body: typeof resultingBody === "string" ? resultingBody : null,
    };
    if (!isPushVariantComplete(candidate)) {
      const missing = missingPushFields(candidate).join(" and ");
      return NextResponse.json(
        { error: `push requires a non-empty ${missing}` },
        { status: 400 }
      );
    }
  }

  let updated;
  try {
    updated = await prisma.messageVariant.update({
      where: { id },
      data: updateData,
    });
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // If this is a template variant, sync copy fields to all clones.
  let clonesUpdated = 0;
  if (message?.agent?.name === LIBRARY_AGENT_NAME) {
    const copyData = Object.fromEntries(
      TEMPLATE_COPY_FIELDS.map((f) => [f, (updated as Record<string, unknown>)[f]])
    );
    clonesUpdated = await syncClonesFromTemplate(id, copyData);
    revalidateTag("agents", "max");
  }

  return NextResponse.json({ data: updated, clonesUpdated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  try {
    const existing = await prisma.messageVariant.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Variant not found" }, { status: 404 });
    }

    await prisma.messageVariant.delete({
      where: { id },
    });
    return NextResponse.json({ data: { id } });
  } catch {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
