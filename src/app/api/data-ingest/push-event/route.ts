import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { POST as ingestPost } from "@/app/api/ingest/events/route";

type PushEventBody = {
  external_user_id: string;
  event_name: string;
  occurred_at: string;
  properties?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).external_user_id !== "string" ||
    typeof (body as Record<string, unknown>).event_name !== "string" ||
    typeof (body as Record<string, unknown>).occurred_at !== "string"
  ) {
    return NextResponse.json(
      { error: "external_user_id, event_name, and occurred_at are required strings" },
      { status: 400 }
    );
  }

  const { external_user_id, event_name, occurred_at, properties } =
    body as PushEventBody;

  if (!external_user_id.trim() || !event_name.trim()) {
    return NextResponse.json(
      { error: "external_user_id and event_name must not be empty" },
      { status: 400 }
    );
  }

  if (isNaN(new Date(occurred_at).getTime())) {
    return NextResponse.json(
      { error: "occurred_at must be a valid ISO 8601 date string" },
      { status: 400 }
    );
  }

  const ingestReq = new NextRequest("http://localhost/api/ingest/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HIGHTOUCH_API_KEY ?? process.env.INGEST_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      event_id: crypto.randomUUID(),
      event_name,
      external_user_id,
      occurred_at,
      properties: properties ?? {},
    }),
  });

  const ingestRes = await ingestPost(ingestReq);
  const ingestBody = await ingestRes.json();
  return NextResponse.json({ data: ingestBody }, { status: ingestRes.status });
}
