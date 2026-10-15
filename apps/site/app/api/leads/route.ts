import { NextResponse, type NextRequest } from "next/server";
import { Pool } from "pg";
import { config } from "@site/lib/config";
import { sendLeadEmail } from "@site/lib/leads/email";
import { handleLead } from "@site/lib/leads/handle-lead";
import { pgLeadStore } from "@site/lib/leads/store";

let pool: Pool | undefined;
const getPool = () => (pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3 }));

export async function POST(req: NextRequest): Promise<NextResponse<{ data: { ok: true } } | { error: string }>> {
  const body: unknown = await req.json().catch(() => null);
  const ip =
    req.headers.get("x-vercel-forwarded-for")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const result = await handleLead(
    body,
    { ip, userAgent: req.headers.get("user-agent") ?? "", now: new Date(), ipSalt: config.leadIpSalt },
    {
      store: pgLeadStore(getPool()),
      email: (lead) => sendLeadEmail(lead, { apiKey: process.env.RESEND_API_KEY, to: config.leadNotifyEmail, from: config.leadFromEmail }),
      log: (msg, err) => console.error(msg, err instanceof Error ? err.message : err),
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
