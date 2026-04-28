import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const variants = await prisma.messageVariant.findMany({
      where: { status: "active" },
      select: {
        id: true,
        name: true,
        title: true,
        body: true,
        deeplink: true,
        cta: true,
        message: { select: { channel: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json(variants);
  } catch (error) {
    console.error("GET /api/variants error:", error);
    return NextResponse.json({ error: "Failed to fetch variants" }, { status: 500 });
  }
}
