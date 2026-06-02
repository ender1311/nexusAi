import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { detectTestedVariables } from "@/lib/engine/variant-diff";
import { MessageVariant } from "@/types/agent";
import { requireAdmin } from "@/lib/auth";

type VariantInput = {
  name?: string;
  subject?: string;
  body: string;
  cta?: string;
  title?: string;
  iconImageUrl?: string;
  deeplink?: string;
  preferredHour?: number;
  preferredDayOfWeek?: number;
  frequencyCapOverride?: Prisma.InputJsonValue | null;
  sourceTemplateId?: string | null;
};

function sanitizeVariant(input: VariantInput) {
  return {
    name: (input.name ?? "V1").trim(),
    subject: input.subject?.trim() || null,
    body: input.body.trim(),
    cta: input.cta?.trim() || null,
    title: input.title?.trim() || null,
    iconImageUrl: input.iconImageUrl?.trim() || null,
    deeplink: input.deeplink?.trim() || null,
    preferredHour: input.preferredHour ?? null,
    preferredDayOfWeek: input.preferredDayOfWeek ?? null,
    sourceTemplateId: input.sourceTemplateId ?? null,
    frequencyCapOverride:
      input.frequencyCapOverride === null
        ? Prisma.JsonNull
        : input.frequencyCapOverride,
  };
}

function toDetectVariant(input: {
  id?: string;
  messageId?: string;
  name: string;
  subject: string | null;
  body: string;
  cta: string | null;
  status?: string;
  brazeVariantId?: string | null;
  title: string | null;
  iconImageUrl: string | null;
  deeplink: string | null;
  preferredHour: number | null;
  preferredDayOfWeek: number | null;
  frequencyCapOverride?: Prisma.JsonValue | null;
  category?: string | null;
}): MessageVariant {
  return {
    id: input.id ?? "",
    messageId: input.messageId ?? "",
    name: input.name,
    subject: input.subject,
    body: input.body,
    cta: input.cta,
    status: (input.status as "active" | "paused") ?? "active",
    brazeVariantId: input.brazeVariantId ?? null,
    title: input.title,
    iconImageUrl: input.iconImageUrl,
    deeplink: input.deeplink,
    preferredHour: input.preferredHour,
    preferredDayOfWeek: input.preferredDayOfWeek,
    frequencyCapOverride: input.frequencyCapOverride ? JSON.stringify(input.frequencyCapOverride) : null,
    sourceTemplateId: null,
    category: input.category ?? null,
    createdAt: "",
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const messages = await prisma.message.findMany({
      where: { agentId: id },
      include: { variants: true },
      orderBy: { createdAt: "asc" },
    });
    const res = NextResponse.json(messages);
    res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res;
  } catch (error) {
    console.error("GET /api/agents/[id]/messages error:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const body = await req.json();
    const { messageId, name, channel, variants = [], variant } = body as {
      messageId?: string;
      name?: string;
      channel?: string;
      variants?: VariantInput[];
      variant?: VariantInput;
    };

    if (messageId) {
      if (!variant || !variant.body?.trim()) {
        return NextResponse.json({ error: "variant body is required" }, { status: 400 });
      }

      const existingMessage = await prisma.message.findFirst({
        where: { id: messageId, agentId: id },
        include: { variants: true },
      });
      if (!existingMessage) {
        return NextResponse.json({ error: "Message not found" }, { status: 404 });
      }

      const created = await prisma.messageVariant.create({
        data: {
          messageId,
          ...sanitizeVariant(variant),
        },
      });

      const refreshedVariants = [...existingMessage.variants, created].map((existingVariant) =>
        toDetectVariant({
          id: existingVariant.id,
          messageId: existingVariant.messageId,
          name: existingVariant.name,
          subject: existingVariant.subject,
          body: existingVariant.body,
          cta: existingVariant.cta,
          status: existingVariant.status,
          brazeVariantId: existingVariant.brazeVariantId,
          title: existingVariant.title,
          iconImageUrl: existingVariant.iconImageUrl,
          deeplink: existingVariant.deeplink,
          preferredHour: existingVariant.preferredHour,
          preferredDayOfWeek: existingVariant.preferredDayOfWeek,
          frequencyCapOverride: existingVariant.frequencyCapOverride,
          category: existingVariant.category,
        }),
      );
      const testedVariables = detectTestedVariables(refreshedVariants);

      await prisma.message.update({
        where: { id: messageId },
        data: { testedVariables },
      });

      // Build response from in-memory data to avoid Neon read-after-write latency
      // (a follow-up findUnique can return stale results before the write propagates).
      const allVariants = [...existingMessage.variants, created].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const updatedMessage = { ...existingMessage, testedVariables, variants: allVariants };

      return NextResponse.json(updatedMessage, { status: 201 });
    }

    if (!name?.trim() || !channel) {
      return NextResponse.json({ error: "name and channel are required" }, { status: 400 });
    }
    if (!Array.isArray(variants) || variants.length === 0) {
      return NextResponse.json({ error: "at least one variant is required" }, { status: 400 });
    }
    if (variants.some((v) => !v.body?.trim())) {
      return NextResponse.json({ error: "each variant requires body" }, { status: 400 });
    }

    const sanitizedVariants = variants.map(sanitizeVariant);

    const message = await prisma.message.create({
      data: {
        agentId: id,
        name: name.trim(),
        channel,
        testedVariables: detectTestedVariables(
          sanitizedVariants.map((variant) =>
            toDetectVariant({
              name: variant.name,
              subject: variant.subject,
              body: variant.body,
              cta: variant.cta,
              title: variant.title,
              iconImageUrl: variant.iconImageUrl,
              deeplink: variant.deeplink,
              preferredHour: variant.preferredHour,
              preferredDayOfWeek: variant.preferredDayOfWeek,
              frequencyCapOverride:
                variant.frequencyCapOverride && variant.frequencyCapOverride !== Prisma.JsonNull
                  ? (variant.frequencyCapOverride as Prisma.JsonValue)
                  : null,
            }),
          ),
        ),
        variants: {
          create: sanitizedVariants,
        },
      },
      include: {
        variants: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error("POST /api/agents/[id]/messages error:", error);
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const body = await req.json();
    const { messageId, name, channel, variants } = body;

    const message = await prisma.message.update({
      where: { id: messageId, agentId: id },
      data: {
        ...(name && { name }),
        ...(channel && { channel }),
        ...(variants && { testedVariables: detectTestedVariables(variants as MessageVariant[]) }),
      },
      include: { variants: true },
    });

    return NextResponse.json(message);
  } catch (error) {
    console.error("PUT /api/agents/[id]/messages error:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}
