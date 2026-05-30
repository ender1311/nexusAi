import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { parseHiddenStats, sanitizeHiddenStats, type StatKey } from "@/lib/stat-visibility";

type StatVisibilityResponse = { data: { hiddenStats: StatKey[] } } | { error: string };

export async function GET(): Promise<NextResponse<StatVisibilityResponse>> {
  try {
    const { user } = await getAuth();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const pref = await prisma.userPreference.findUnique({
      where: { workosUserId: user.id },
    });
    return NextResponse.json({ data: { hiddenStats: parseHiddenStats(pref?.hiddenStats) } });
  } catch (error) {
    console.error("GET /api/preferences/stat-visibility error:", error);
    return NextResponse.json({ error: "Failed to fetch preferences" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse<StatVisibilityResponse>> {
  try {
    const { user } = await getAuth();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const raw = (body as { hiddenStats?: unknown })?.hiddenStats;
    const hiddenStats = sanitizeHiddenStats(raw);
    const serialized = JSON.stringify(hiddenStats);

    await prisma.userPreference.upsert({
      where: { workosUserId: user.id },
      update: { hiddenStats: serialized },
      create: { workosUserId: user.id, hiddenStats: serialized },
    });

    return NextResponse.json({ data: { hiddenStats } });
  } catch (error) {
    console.error("PUT /api/preferences/stat-visibility error:", error);
    return NextResponse.json({ error: "Failed to update preferences" }, { status: 500 });
  }
}
