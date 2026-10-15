import { createHmac, randomUUID } from "node:crypto";
import { leadSchema } from "./schema";
import type { LeadRecord, LeadStore } from "./store";

export const LEAD_RATE_LIMIT_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

type Result = { status: number; body: { data: { ok: true } } | { error: string } };

export async function handleLead(
  body: unknown,
  ctx: { ip: string; userAgent: string; now: Date; ipSalt: string },
  deps: {
    store: LeadStore;
    email: (l: LeadRecord) => Promise<void>;
    log: (msg: string, err?: unknown) => void;
    /** Runs work after the response is sent (Next's `after`). Omitted: the work is awaited inline. */
    afterResponse?: (fn: () => Promise<void>) => void;
  },
): Promise<Result> {
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "Please check the form and try again." } };
  if (parsed.data.nx_hp) return { status: 200, body: { data: { ok: true } } }; // honeypot: pretend success

  const ipHash = createHmac("sha256", ctx.ipSalt).update(ctx.ip).digest("hex");
  try {
    const { email, company, source, sender, useCase } = parsed.data;
    const lead: LeadRecord = { id: randomUUID(), email, company, source, sender, useCase, ipHash, userAgent: ctx.userAgent.slice(0, 300), createdAt: ctx.now };
    const inserted = await deps.store.insertIfUnderLimit(lead, new Date(ctx.now.getTime() - HOUR_MS), LEAD_RATE_LIMIT_PER_HOUR);
    if (!inserted) return { status: 429, body: { error: "Too many requests. Try again later." } };
    const notify = async () => {
      try {
        await deps.email(lead);
      } catch (err) {
        deps.log("[leads] email notification failed; lead is stored", err);
      }
    };
    if (deps.afterResponse) deps.afterResponse(notify);
    else await notify();
    return { status: 201, body: { data: { ok: true } } };
  } catch (err) {
    deps.log("[leads] storage failed", err);
    return { status: 500, body: { error: "Something went wrong. Please try again." } };
  }
}
