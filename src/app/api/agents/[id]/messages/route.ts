import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { detectTestedVariables } from "@/lib/engine/variant-diff";
import { MessageVariant } from "@/types/agent";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const messages = await prisma.message.findMany({
      where: { agentId: id },
      include: { variants: true },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(messages);
  } catch (error) {
    console.error("GET /api/agents/[id]/messages error:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const { name, channel, variants = [] } = body;

    const message = await prisma.message.create({
      data: {
        agentId: id,
        name,
        channel,
        testedVariables: detectTestedVariables(variants as MessageVariant[]),
        variants: {
          create: variants.map((v: {
            name?: string;
            subject?: string;
            body: string;
            cta?: string;
            title?: string;
            iconImageUrl?: string;
            deeplink?: string;
            preferredHour?: number;
            preferredDayOfWeek?: number;
            frequencyCapOverride?: string;
          }) => ({
            name: v.name ?? "V1",
            subject: v.subject,
            body: v.body,
            cta: v.cta,
            title: v.title,
            iconImageUrl: v.iconImageUrl,
            deeplink: v.deeplink,
            preferredHour: v.preferredHour,
            preferredDayOfWeek: v.preferredDayOfWeek,
            frequencyCapOverride: v.frequencyCapOverride,
          })),
        },
      },
      include: { variants: true },
    });

    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.error("POST /api/agents/[id]/messages error:", error);
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
