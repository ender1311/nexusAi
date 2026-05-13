import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";

export async function GET() {
  const settings = await prisma.appSetting.findMany();
  const map: Record<string, string> = {};
  settings.forEach((s: { key: string; value: string }) => { map[s.key] = s.value; });
  return NextResponse.json(map);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const results: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(body)) {
    const setting = await prisma.appSetting.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) },
    });
    results.push(setting);
  }
  revalidateTag("lift-settings");
  return NextResponse.json(results);
}
