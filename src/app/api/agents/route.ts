import { NextRequest, NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api-client";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  try {
    const agents = await apiFetch<unknown[]>("/agents");
    const res = NextResponse.json(agents);
    res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res;
  } catch (err) {
    console.error("GET /api/agents proxy error:", err);
    return NextResponse.json({ error: "Failed to fetch agents" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const body = await req.json();
    const agent = await apiFetch("/agents", {
      method: "POST",
      body: JSON.stringify(body),
      isAdmin: true,
    });
    return NextResponse.json(agent, { status: 201 });
  } catch (err) {
    console.error("POST /api/agents proxy error:", err);
    const status = err instanceof ApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed to create agent";
    return NextResponse.json({ error: message }, { status });
  }
}
