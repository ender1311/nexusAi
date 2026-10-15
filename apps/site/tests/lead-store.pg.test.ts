// Runs only against the local test DB: TEST_DB=true bun --cwd apps/site test tests/lead-store.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { pgLeadStore } from "@site/lib/leads/store";

const LOCAL = `postgresql://${process.env.USER}@localhost:5432/nexus_test?sslmode=disable`;
const enabled = process.env.TEST_DB === "true";

describe.skipIf(!enabled)("pgLeadStore (local nexus_test)", () => {
  const pool = new Pool({ connectionString: LOCAL });
  beforeAll(async () => {
    await pool.query(readFileSync(path.join(import.meta.dir, "../db/001_design_partner_lead.sql"), "utf8"));
    await pool.query(`DELETE FROM "DesignPartnerLead" WHERE "ipHash" = 'test-ip'`);
  });
  afterAll(async () => { await pool.query(`DELETE FROM "DesignPartnerLead" WHERE "ipHash" = 'test-ip'`); await pool.end(); });

  it("inserts and counts by ipHash within a window", async () => {
    const store = pgLeadStore(pool);
    const at = new Date("2026-10-14T12:00:00Z");
    await store.insert({ id: "t1", email: "a@b.co", company: "B", source: "csv", sender: "braze", useCase: "x", ipHash: "test-ip", userAgent: "ua", createdAt: at });
    expect(await store.countSince("test-ip", new Date("2026-10-14T11:00:00Z"))).toBe(1);
    expect(await store.countSince("test-ip", new Date("2026-10-14T12:00:01Z"))).toBe(0);
  });
});
