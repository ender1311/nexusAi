import { after, NextResponse, type NextRequest } from "next/server";
import { Pool } from "pg";
import { config, resolveIpSalt } from "@site/lib/config";
import { sendLeadEmail } from "@site/lib/leads/email";
import { handleLead } from "@site/lib/leads/handle-lead";
import { pgLeadStore } from "@site/lib/leads/store";

let pool: Pool | undefined;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
    pool.on("error", (e) => console.error("[leads] pg pool error", e.message));
  }
  return pool;
}

export async function POST(req: NextRequest): Promise<NextResponse<{ data: { ok: true } } | { error: string }>> {
  const ipSalt = resolveIpSalt(process.env);
  if (ipSalt === null) {
    console.error("[leads] LEAD_IP_SALT is not set");
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
  const body: unknown = await req.json().catch(() => null);
  const ip =
    req.headers.get("x-vercel-forwarded-for")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const result = await handleLead(
    body,
    { ip, userAgent: req.headers.get("user-agent") ?? "", now: new Date(), ipSalt },
    {
      store: pgLeadStore(getPool()),
      email: (lead) => sendLeadEmail(lead, { apiKey: process.env.RESEND_API_KEY, to: config.leadNotifyEmail, from: config.leadFromEmail }),
      log: (msg, err) => console.error(msg, err instanceof Error ? err.message : err),
      afterResponse: (fn) => after(fn),
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
