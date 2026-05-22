import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { decideForUser } from "@/lib/decide";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { randomUUID } from "crypto";

type SendResult = {
  userId: string;
  status: "sent" | "suppressed" | "failed";
  variantName?: string;
  reason?: string;
};

// Legacy types retained for LiveDemoWizard which uses the preview→send flow
export type DemoSendResult = {
  userId: string;
  status: "sent" | "error" | "skipped";
  error?: string;
};

export type DemoSendResponse = {
  results: DemoSendResult[];
  sent: number;
  errors: number;
  skipped: number;
};

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { agentId, userIds } = (body ?? {}) as Record<string, unknown>;
  if (typeof agentId !== "string" || !Array.isArray(userIds) || userIds.length === 0) {
    return NextResponse.json({ error: "agentId and non-empty userIds array required" }, { status: 400 });
  }
  if (userIds.length > 20) {
    return NextResponse.json({ error: "Max 20 users per demo send" }, { status: 400 });
  }
  if (!userIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "userIds must be strings" }, { status: 400 });
  }

  const brazeClient = createBrazeClient();
  const factory = brazeClient ? new PayloadFactory() : null;
  const campaignId = process.env.BRAZE_NEXUS_CAMPAIGN_ID;

  const results: SendResult[] = await Promise.all(
    (userIds as string[]).map(async (userId): Promise<SendResult> => {
      try {
        const decision = await decideForUser({ agentId, externalUserId: userId });
        if (!decision) return { userId, status: "failed", reason: "agent not found or no variants" };
        if (decision.suppressed) return { userId, status: "suppressed", reason: decision.reason };

        const variant = await prisma.messageVariant.findUnique({
          where: { id: decision.messageVariantId },
          select: { name: true, title: true, body: true, deeplink: true },
        });
        if (!variant) return { userId, status: "failed", reason: "variant not found" };

        if (!brazeClient || !factory) {
          return { userId, status: "failed", reason: "Braze not configured", variantName: variant.name };
        }

        const payload = factory.buildPushPayload(
          { title: variant.title ?? "", body: variant.body, deeplink: variant.deeplink ?? undefined },
          { externalUserIds: [userId] },
          campaignId,
          decision.brazeVariantId ?? undefined,
          false,
        );

        const res = await brazeClient.post("/messages/send", payload);
        if (!res.ok) {
          console.error("[demo/send] Braze error:", res.status, userId);
          return { userId, status: "failed", reason: "Braze send failed", variantName: variant.name };
        }

        await prisma.userDecision.update({
          where: { id: decision.userDecisionId },
          data: { brazeSendId: randomUUID() },
        }).catch(() => {}); // non-critical

        return { userId, status: "sent", variantName: variant.name };
      } catch (err) {
        console.error("[demo/send] error for user", userId, err);
        return { userId, status: "failed", reason: "internal error" };
      }
    })
  );

  return NextResponse.json({ data: results });
}
