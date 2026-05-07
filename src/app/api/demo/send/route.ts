import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { buildDemoTitle } from "@/lib/braze/demo-utils";
import type { DemoAssignment } from "../preview/route";

export type DemoSendResult = {
  userId: string;
  status: "sent" | "error";
  error?: string;
};

export type DemoSendResponse = {
  results: DemoSendResult[];
  sent: number;
  errors: number;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agentId, assignments } = body as {
      agentId?: unknown;
      assignments?: unknown;
    };

    if (typeof agentId !== "string" || !agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return NextResponse.json({ error: "assignments must be a non-empty array" }, { status: 400 });
    }
    if (assignments.length > 20) {
      return NextResponse.json({ error: "Maximum 20 assignments per send" }, { status: 400 });
    }

    const brazeClient = createBrazeClient();
    if (!brazeClient) {
      return NextResponse.json(
        { error: "Braze is not configured — add BRAZE_API_KEY and BRAZE_REST_ENDPOINT" },
        { status: 503 }
      );
    }

    const factory = new PayloadFactory();
    const typedAssignments = assignments as DemoAssignment[];

    const results: DemoSendResult[] = [];
    let sent = 0;
    let errors = 0;

    for (const assignment of typedAssignments) {
      const { userId, variant } = assignment;
      if (!userId || !variant) {
        results.push({ userId: String(userId ?? "unknown"), status: "error", error: "Invalid assignment" });
        errors++;
        continue;
      }

      try {
        const personalizedTitle = buildDemoTitle(variant.title);

        // Build push payload — no campaign_id for demo (transactional send)
        const payload = factory.buildPushPayload(
          {
            title: personalizedTitle,
            body: variant.body,
            ...(variant.deeplink ? { deeplink: variant.deeplink } : {}),
          },
          { externalUserIds: [userId] }
        );

        const res = await brazeClient.post("/messages/send", payload);

        if (!res.ok) {
          const errText = await res.text().catch(() => `HTTP ${res.status}`);
          console.error(`[demo/send] Braze error for user ${userId}:`, errText);
          results.push({ userId, status: "error", error: `Braze ${res.status}` });
          errors++;
          continue;
        }

        // Record UserDecision for analytics tracking
        await prisma.userDecision.create({
          data: {
            agentId,
            userId,
            messageVariantId: variant.id,
            channel: "push",
            decisionContext: { source: "demo", personaId: assignment.persona.id },
          },
        });

        results.push({ userId, status: "sent" });
        sent++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[demo/send] Exception for user ${userId}:`, err);
        results.push({ userId, status: "error", error: reason });
        errors++;
      }
    }

    return NextResponse.json<DemoSendResponse>({ results, sent, errors });
  } catch (error) {
    console.error("POST /api/demo/send error:", error);
    return NextResponse.json({ error: "Failed to send demo messages" }, { status: 500 });
  }
}
