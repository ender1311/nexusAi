import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isInteractionFlag } from "@/lib/constants/interaction-flags";

const VALID_CONV_TYPES = new Set(["first_interaction", "any_interaction"]);

function validateConversionType(conversionType: unknown, eventName: string): string | null {
  if (conversionType === undefined || conversionType === null) return null;
  if (typeof conversionType !== "string" || !VALID_CONV_TYPES.has(conversionType)) {
    return "goal.conversionType must be 'first_interaction' or 'any_interaction'";
  }
  if (!isInteractionFlag(eventName.trim())) {
    return "conversionType is only valid for *_has_ever_flag interaction-flag goals";
  }
  return null;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const goals = await prisma.goal.findMany({ where: { agentId: id } });
    return NextResponse.json(goals);
  } catch (error) {
    console.error("GET /api/agents/[id]/goals error:", error);
    return NextResponse.json({ error: "Failed to fetch goals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof raw !== "object" || raw === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = raw as {
    eventName?: unknown;
    tier?: unknown;
    valueWeight?: unknown;
    weightMode?: unknown;
    weightProperty?: unknown;
    weightDefault?: unknown;
    description?: unknown;
    conversionType?: unknown;
  };
  if (typeof body.eventName !== "string" || body.eventName.trim() === "") {
    return NextResponse.json({ error: "eventName is required" }, { status: 400 });
  }
  if (typeof body.tier !== "string" || body.tier.trim() === "") {
    return NextResponse.json({ error: "tier is required" }, { status: 400 });
  }
  const convTypeError = validateConversionType(body.conversionType, body.eventName);
  if (convTypeError !== null) {
    return NextResponse.json({ error: convTypeError }, { status: 400 });
  }

  try {
    const { id } = await params;
    const goal = await prisma.goal.create({
      data: {
        agentId: id,
        eventName: body.eventName.trim(),
        tier: body.tier.trim(),
        valueWeight: typeof body.valueWeight === "number" ? body.valueWeight : 1.0,
        weightMode: typeof body.weightMode === "string" ? body.weightMode : "fixed",
        weightProperty: typeof body.weightProperty === "string" ? body.weightProperty : null,
        weightDefault: typeof body.weightDefault === "number" ? body.weightDefault : 1.0,
        description: typeof body.description === "string" ? body.description : null,
        conversionType: typeof body.conversionType === "string" ? body.conversionType : null,
      },
    });
    revalidatePath(`/agents/${id}`);
    revalidateTag(`agent-${id}`, "max");
    return NextResponse.json(goal, { status: 201 });
  } catch (error) {
    console.error("POST /api/agents/[id]/goals error:", error);
    return NextResponse.json({ error: "Failed to create goal" }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/goals
 * Replace all goals for an agent (delete + recreate pattern).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "Expected array of goals" }, { status: 400 });
  }

  // Validate every entry BEFORE any destructive write — otherwise a malformed
  // goal later in the array would delete all existing goals and then 500.
  for (const g of raw) {
    if (typeof g !== "object" || g === null) {
      return NextResponse.json({ error: "Invalid goal entry" }, { status: 400 });
    }
    const entry = g as { eventName?: unknown; tier?: unknown; conversionType?: unknown };
    if (typeof entry.eventName !== "string" || entry.eventName.trim() === "") {
      return NextResponse.json({ error: "Each goal requires eventName" }, { status: 400 });
    }
    if (typeof entry.tier !== "string" || entry.tier.trim() === "") {
      return NextResponse.json({ error: "Each goal requires tier" }, { status: 400 });
    }
    const convTypeErr = validateConversionType(entry.conversionType, entry.eventName);
    if (convTypeErr !== null) {
      return NextResponse.json({ error: convTypeErr }, { status: 400 });
    }
  }

  const entries = raw as Array<{
    eventName: string;
    tier: string;
    valueWeight?: unknown;
    weightMode?: unknown;
    weightProperty?: unknown;
    weightDefault?: unknown;
    description?: unknown;
    conversionType?: unknown;
  }>;

  try {
    const { id } = await params;

    await prisma.goal.deleteMany({ where: { agentId: id } });

    if (entries.length > 0) {
      await prisma.goal.createMany({
        data: entries.map((g) => ({
          agentId: id,
          eventName: g.eventName.trim(),
          tier: g.tier.trim(),
          valueWeight: typeof g.valueWeight === "number" ? g.valueWeight : 1.0,
          weightMode: typeof g.weightMode === "string" ? g.weightMode : "fixed",
          weightProperty: typeof g.weightProperty === "string" ? g.weightProperty : null,
          weightDefault: typeof g.weightDefault === "number" ? g.weightDefault : 1.0,
          description: typeof g.description === "string" ? g.description : null,
          conversionType: typeof g.conversionType === "string" ? g.conversionType : null,
        })),
      });
    }

    const goals = await prisma.goal.findMany({ where: { agentId: id } });
    revalidatePath(`/agents/${id}`);
    revalidateTag(`agent-${id}`, "max");
    return NextResponse.json(goals);
  } catch (error) {
    console.error("PUT /api/agents/[id]/goals error:", error);
    return NextResponse.json({ error: "Failed to update goals" }, { status: 500 });
  }
}
