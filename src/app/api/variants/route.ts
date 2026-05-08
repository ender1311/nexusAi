import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const category = params.get("category");
    const subcategory = params.get("subcategory");
    const channel = params.get("channel");

    const variants = await prisma.messageVariant.findMany({
      where: {
        status: "active",
        // Only library templates (sourceTemplateId = null). Clones are agent-owned
        // copies — showing them in pickers would create clone-of-clone relationships.
        sourceTemplateId: null,
        ...(category ? { category } : {}),
        ...(subcategory ? { subcategory } : {}),
        ...(channel ? { message: { channel } } : {}),
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

    const res = NextResponse.json(variants);
    res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res;
  } catch (error) {
    console.error("GET /api/variants error:", error);
    return NextResponse.json({ error: "Failed to fetch variants" }, { status: 500 });
  }
}
