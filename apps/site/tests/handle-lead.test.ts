import { describe, expect, it } from "bun:test";
import { handleLead, LEAD_RATE_LIMIT_PER_HOUR } from "@site/lib/leads/handle-lead";
import type { LeadRecord, LeadStore } from "@site/lib/leads/store";

function memoryStore(): LeadStore & { rows: LeadRecord[] } {
  const rows: LeadRecord[] = [];
  return {
    rows,
    async insertIfUnderLimit(lead, since, max) {
      if (rows.filter((r) => r.ipHash === lead.ipHash && r.createdAt >= since).length >= max) return false;
      rows.push(lead);
      return true;
    },
  };
}
const valid = { email: "ana@acme.io", company: "Acme", source: "snowflake", sender: "iterable", useCase: "Win back lapsed trial users", website: "" };
const ctx = { ip: "203.0.113.7", userAgent: "test", ipSalt: "test-salt", now: new Date("2026-10-14T12:00:00Z") };

describe("handleLead", () => {
  it("stores a valid lead, emails it, returns 201", async () => {
    const store = memoryStore(); const sent: LeadRecord[] = [];
    const res = await handleLead(valid, ctx, { store, email: async (l) => { sent.push(l); }, log: () => {} });
    expect(res).toEqual({ status: 201, body: { data: { ok: true } } });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.ipHash).not.toContain("203.0.113.7");
    expect(sent).toHaveLength(1);
  });

  it("rejects invalid input with 400 and stores nothing", async () => {
    const store = memoryStore();
    for (const bad of [{ ...valid, email: "nope" }, { ...valid, company: "" }, { ...valid, company: "Acme\r\nBcc: x@evil.io" }, { ...valid, useCase: "x".repeat(281) }, null, "str"]) {
      const res = await handleLead(bad, ctx, { store, email: async () => {}, log: () => {} });
      expect(res.status).toBe(400);
      expect("error" in res.body).toBe(true);
    }
    expect(store.rows).toHaveLength(0);
  });

  it("silently accepts a honeypot hit with 200 and stores nothing", async () => {
    const store = memoryStore(); let emailed = false;
    const res = await handleLead({ ...valid, website: "http://spam" }, ctx, { store, email: async () => { emailed = true; }, log: () => {} });
    expect(res.status).toBe(200);
    expect(store.rows).toHaveLength(0);
    expect(emailed).toBe(false);
  });

  it("rate-limits after LEAD_RATE_LIMIT_PER_HOUR leads per IP per hour", async () => {
    const store = memoryStore();
    for (let i = 0; i < LEAD_RATE_LIMIT_PER_HOUR; i++) {
      expect((await handleLead(valid, ctx, { store, email: async () => {}, log: () => {} })).status).toBe(201);
    }
    const res = await handleLead(valid, ctx, { store, email: async () => {}, log: () => {} });
    expect(res.status).toBe(429);
    const later = { ...ctx, now: new Date("2026-10-14T13:00:01Z") };
    expect((await handleLead(valid, later, { store, email: async () => {}, log: () => {} })).status).toBe(201);
  });

  it("stores the lead and returns 201 when email fails", async () => {
    const store = memoryStore(); const logs: string[] = [];
    const res = await handleLead(valid, ctx, { store, email: async () => { throw new Error("resend down"); }, log: (m) => logs.push(m) });
    expect(res.status).toBe(201);
    expect(store.rows).toHaveLength(1);
    expect(logs.join(" ")).toContain("email");
  });

  it("returns a generic 500 when storage fails, never the DB message", async () => {
    const store: LeadStore = { insertIfUnderLimit: async () => { throw new Error('relation "DesignPartnerLead" does not exist'); } };
    const res = await handleLead(valid, ctx, { store, email: async () => {}, log: () => {} });
    expect(res).toEqual({ status: 500, body: { error: "Something went wrong. Please try again." } });
  });
});
