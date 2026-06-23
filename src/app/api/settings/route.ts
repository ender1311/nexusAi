import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isPlainObject } from "@/lib/utils";

// Keys safe to expose to any authenticated staff session. GET returns ONLY
// these — never `findMany()` the whole table, so a secret accidentally stored
// in AppSetting can never leak to the client. Add a key here only when the UI
// must read it back.
const CLIENT_READABLE_KEYS = [
  "baseline_push_open_rate",
  "baseline_conversion_rate",
  "lift_since_date",
  "giving_dollars_to_bibles_multiplier",
  "push_targeting_mode",
] as const;

export async function GET() {
  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { in: [...CLIENT_READABLE_KEYS] } },
    });
    const map: Record<string, string> = {};
    settings.forEach((s: { key: string; value: string }) => { map[s.key] = s.value; });
    return NextResponse.json(map);
  } catch (error) {
    console.error("GET /api/settings error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isPlainObject(raw)) {
    return NextResponse.json({ error: "Expected an object of settings" }, { status: 400 });
  }

  try {
    const results: Array<{ key: string; value: string }> = [];
    for (const [key, value] of Object.entries(raw)) {
      const setting = await prisma.appSetting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
      results.push(setting);
    }
    revalidateTag("lift-settings", "max");
    return NextResponse.json(results);
  } catch (error) {
    console.error("POST /api/settings error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
