import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const VALID_CONTENT_TYPES = new Set(["a-title", "b-title", "verse-text", "reference"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const campaign = searchParams.get("campaign");
  const language = searchParams.get("language");

  if (!campaign) {
    return NextResponse.json({ error: "campaign is required" }, { status: 400 });
  }

  try {
    const rows = await prisma.campaignContent.findMany({
      where: {
        campaign,
        status: "active",
        ...(language ? { language } : {}),
      },
      orderBy: [{ language: "asc" }, { usfmReference: "asc" }, { contentType: "asc" }],
    });
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/campaign-content error:", error);
    return NextResponse.json({ error: "Failed to fetch content" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { campaign, contentType, language, usfmReference, usfmHuman, title, body: msgBody } =
    body as Record<string, unknown>;

  if (typeof campaign !== "string" || !campaign.trim()) {
    return NextResponse.json({ error: "campaign is required" }, { status: 400 });
  }
  if (typeof contentType !== "string" || !VALID_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: "contentType must be a-title, b-title, verse-text, or reference" },
      { status: 400 }
    );
  }
  if (typeof language !== "string" || !language.trim()) {
    return NextResponse.json({ error: "language is required" }, { status: 400 });
  }
  if (typeof usfmReference !== "string" || !usfmReference.trim()) {
    return NextResponse.json({ error: "usfmReference is required" }, { status: 400 });
  }

  const isTitle = contentType === "a-title" || contentType === "b-title";
  if (isTitle && (typeof title !== "string" || !title.trim())) {
    return NextResponse.json({ error: "title is required for a-title and b-title" }, { status: 400 });
  }
  if (!isTitle && (typeof msgBody !== "string" || !(msgBody as string).trim())) {
    return NextResponse.json({ error: "body is required for verse-text and reference" }, { status: 400 });
  }

  try {
    const row = await prisma.campaignContent.create({
      data: {
        campaign: campaign.trim(),
        contentType,
        language: language.trim(),
        usfmReference: usfmReference.trim(),
        usfmHuman: typeof usfmHuman === "string" ? usfmHuman.trim() || null : null,
        title: isTitle ? (title as string).trim() : null,
        body: !isTitle ? (msgBody as string).trim() : null,
      },
    });
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "Content already exists for this campaign/contentType/language/usfmReference combination" },
        { status: 409 }
      );
    }
    console.error("POST /api/campaign-content error:", error);
    return NextResponse.json({ error: "Failed to create content" }, { status: 500 });
  }
}
