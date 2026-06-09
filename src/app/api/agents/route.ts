import { NextRequest, NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api-client";
import { requireAdmin } from "@/lib/auth";
import { fail, handleRouteError } from "@/lib/api/respond";

export const maxDuration = 30;

/** AbortSignal.timeout rejects with a DOMException named "TimeoutError". */
function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
}

export async function GET() {
  try {
    const agents = await apiFetch<unknown[]>("/agents");
    const res = NextResponse.json(agents);
    res.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    return res;
  } catch (err) {
    return handleRouteError("GET /api/agents", err);
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return fail("Invalid JSON body", 400);
  }

  try {
    const agent = await apiFetch<unknown>("/agents", {
      method: "POST",
      body: JSON.stringify(body),
      isAdmin: true,
      timeout: 25000,
    });
    return NextResponse.json(agent, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.message, err.status);
    if (isTimeout(err)) return fail("The agent service took too long to respond. Please try again.", 504);
    return handleRouteError("POST /api/agents", err);
  }
}
