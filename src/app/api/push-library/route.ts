import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";
import { fail, handleRouteError } from "@/lib/api/respond";

const VALID_CATEGORIES = new Set([
  "reader", "plans", "votd", "guided-scripture", "guided-prayer",
]);

export async function GET() {
  try {
    const agent = await prisma.agent.findFirst({
      where: { name: LIBRARY_AGENT_NAME },
    });
    if (!agent) {
      return NextResponse.json({ data: [] });
    }

    const variants = await prisma.messageVariant.findMany({
      where: { message: { agentId: agent.id }, status: { not: "archived" } },
      select: {
        id: true,
        name: true,
        title: true,
        body: true,
        deeplink: true,
        cta: true,
        status: true,
        category: true,
        subcategory: true,
      },
      orderBy: [{ category: "asc" }, { subcategory: "asc" }, { createdAt: "asc" }],
    });

    // Group by category, then subcategory within each group
    const grouped = new Map<string, Map<string | null, typeof variants>>();
    for (const v of variants) {
      const cat = v.category ?? "uncategorized";
      if (!grouped.has(cat)) grouped.set(cat, new Map());
      const subMap = grouped.get(cat)!;
      const sub = v.subcategory ?? null;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push(v);
    }

    const data = Array.from(grouped.entries()).flatMap(([category, subMap]) =>
      Array.from(subMap.entries()).map(([subcategory, vs]) => ({
        category,
        subcategory,
        variants: vs,
      }))
    );

    const res = NextResponse.json({ data });
    res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res;
  } catch (err) {
    return handleRouteError("GET /api/push-library", err);
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  const { name, category, subcategory, title, body: msgBody, deeplink, cta } = body as {
    name?: unknown;
    category?: unknown;
    subcategory?: unknown;
    title?: unknown;
    body?: unknown;
    deeplink?: unknown;
    cta?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return fail("name is required", 400);
  }
  if (typeof category !== "string" || !VALID_CATEGORIES.has(category)) {
    return fail("Invalid category", 400);
  }
  if (typeof msgBody !== "string" || msgBody.trim() === "") {
    return fail("body is required", 400);
  }

  try {
    // Find or create library agent
    let agent = await prisma.agent.findFirst({ where: { name: LIBRARY_AGENT_NAME } });
    if (!agent) {
      agent = await prisma.agent.create({
        data: {
          name: LIBRARY_AGENT_NAME,
          description: "Canonical push copy templates. Never used for decisions — status stays draft.",
          algorithm: "thompson",
          epsilon: 0.1,
          status: "draft",
          funnelStage: "connected",
        },
      });
    }

    // Find existing message for this category, or create one
    let message = await prisma.message.findFirst({
      where: { agentId: agent.id, variants: { some: { category } } },
    });
    if (!message) {
      message = await prisma.message.create({
        data: {
          agentId: agent.id,
          name: `${category} Templates`,
          channel: "push",
        },
      });
    }

    const variant = await prisma.messageVariant.create({
      data: {
        messageId: message.id,
        name: name.trim(),
        title: typeof title === "string" ? title.trim() || null : null,
        body: msgBody.trim(),
        deeplink: typeof deeplink === "string" ? deeplink.trim() || null : null,
        cta: typeof cta === "string" ? cta.trim() || null : null,
        category,
        subcategory: typeof subcategory === "string" ? subcategory.trim() || null : null,
        status: "active",
      },
    });

    revalidateTag("agents", "max");
    return NextResponse.json({ data: variant }, { status: 201 });
  } catch (err) {
    return handleRouteError("POST /api/push-library", err);
  }
}
