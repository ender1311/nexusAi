import { createHash, randomUUID } from "node:crypto";
import { leadSchema } from "./schema";
import type { LeadRecord, LeadStore } from "./store";

export const LEAD_RATE_LIMIT_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

type Result = { status: number; body: { data: { ok: true } } | { error: string } };

export async function handleLead(
  body: unknown,
  ctx: { ip: string; userAgent: string; now: Date },
  deps: { store: LeadStore; email: (l: LeadRecord) => Promise<void>; log: (msg: string, err?: unknown) => void },
): Promise<Result> {
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "Please check the form and try again." } };
  if (parsed.data.website) return { status: 200, body: { data: { ok: true } } }; // honeypot: pretend success

  const ipHash = createHash("sha256").update(`nexus-lead:${ctx.ip}`).digest("hex");
  try {
    const recent = await deps.store.countSince(ipHash, new Date(ctx.now.getTime() - HOUR_MS));
    if (recent >= LEAD_RATE_LIMIT_PER_HOUR) return { status: 429, body: { error: "Too many requests. Try again later." } };

    const { email, company, source, sender, useCase } = parsed.data;
    const lead: LeadRecord = { id: randomUUID(), email, company, source, sender, useCase, ipHash, userAgent: ctx.userAgent.slice(0, 300), createdAt: ctx.now };
    await deps.store.insert(lead);
    try {
      await deps.email(lead);
    } catch (err) {
      deps.log("[leads] email notification failed; lead is stored", err);
    }
    return { status: 201, body: { data: { ok: true } } };
  } catch (err) {
    deps.log("[leads] storage failed", err);
    return { status: 500, body: { error: "Something went wrong. Please try again." } };
  }
}
