import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { constantTimeEqual } from "@/lib/constant-time-compare";

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tag, secret } = body as Record<string, unknown>;

  const expected = process.env.REVALIDATE_SECRET;
  const isValid = typeof secret === "string" && !!expected &&
    constantTimeEqual(secret, expected);
  if (!isValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (typeof tag !== "string" || !tag) {
    return NextResponse.json({ error: "tag required" }, { status: 400 });
  }

  revalidateTag(tag, "max");
  return NextResponse.json({ ok: true });
}
