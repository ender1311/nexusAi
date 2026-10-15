// Runs only against the local test DB: TEST_DB=true bun --cwd apps/site test tests/lead-store.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { pgLeadStore, type LeadRecord } from "@site/lib/leads/store";

const LOCAL = `postgresql://${process.env.USER}@localhost:5432/nexus_test?sslmode=disable`;
const enabled = process.env.TEST_DB === "true";

describe.skipIf(!enabled)("pgLeadStore (local nexus_test)", () => {
  const pool = new Pool({ connectionString: LOCAL });
  beforeAll(async () => {
    await pool.query(readFileSync(path.join(import.meta.dir, "../db/001_design_partner_lead.sql"), "utf8"));
    await pool.query(`DELETE FROM "DesignPartnerLead" WHERE "ipHash" = 'test-ip'`);
  });
  afterAll(async () => { await pool.query(`DELETE FROM "DesignPartnerLead" WHERE "ipHash" = 'test-ip'`); await pool.end(); });

  const lead = (id: string): LeadRecord => ({ id, email: "a@b.co", company: "B", source: "csv", sender: "braze", useCase: "x", ipHash: "test-ip", userAgent: "ua", createdAt: new Date("2026-10-14T12:00:00Z") });
  const since = new Date("2026-10-14T11:00:00Z");

  it("inserts while under the limit and refuses at the limit", async () => {
    const store = pgLeadStore(pool);
    expect(await store.insertIfUnderLimit(lead("t1"), since, 1)).toBe(true);
    expect(await store.insertIfUnderLimit(lead("t2"), since, 1)).toBe(false);
    expect(await store.insertIfUnderLimit(lead("t3"), new Date("2026-10-14T12:00:01Z"), 1)).toBe(true);
  });

  it("holds the limit under parallel requests", async () => {
    const store = pgLeadStore(pool);
    await pool.query(`DELETE FROM "DesignPartnerLead" WHERE "ipHash" = 'test-ip'`);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => store.insertIfUnderLimit(lead(`p${i}`), since, 5)));
    expect(results.filter(Boolean)).toHaveLength(5);
    const r = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM "DesignPartnerLead" WHERE "ipHash" = 'test-ip'`);
    expect(Number(r.rows[0]!.n)).toBe(5);
  });
});
