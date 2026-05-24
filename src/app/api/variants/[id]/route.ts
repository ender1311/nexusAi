import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { LIBRARY_AGENT_NAME, TEMPLATE_COPY_FIELDS, syncClonesFromTemplate } from "@/lib/engine/template-sync";
import { requireAdmin } from "@/lib/auth";

// Fields an operator is allowed to update via PATCH.
// Excludes id, messageId, sourceTemplateId, createdAt (structural / immutable).
const UPDATABLE_FIELDS = new Set([
  "name", "subject", "body", "cta", "status", "brazeVariantId", "title",
  "iconImageUrl", "deeplink", "preferredHour", "preferredDayOfWeek",
  "frequencyCapOverride", "warmupUntil", "actionFeatures", "category",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const forbidden = await requireAdmin();
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
  // Fetch agent name separately to avoid Neon adapter nested-include issues.
  let clonesUpdated = 0;
  const message = await prisma.message.findUnique({
    where: { id: variant.messageId },
    include: { agent: { select: { name: true } } },
  });
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
  const forbidden = await requireAdmin();
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
