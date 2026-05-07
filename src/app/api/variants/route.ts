import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const category = params.get("category");
    const subcategory = params.get("subcategory");
    const variants = await prisma.messageVariant.findMany({
      where: {
        status: "active",
        ...(category ? { category } : {}),
        ...(subcategory ? { subcategory } : {}),
      },
      select: {
        id: true,
        name: true,
        title: true,
        body: true,
        deeplink: true,
        cta: true,
        category: true,
        subcategory: true,
        sourceTemplateId: true,
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
