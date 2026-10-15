import type { Pool } from "pg";

export type LeadRecord = {
  id: string; email: string; company: string; source: string; sender: string;
  useCase: string; ipHash: string; userAgent: string; createdAt: Date;
};

export interface LeadStore {
  /** Atomically inserts the lead unless `max` leads from the same ipHash exist since `since`. Returns whether it inserted. */
  insertIfUnderLimit(lead: LeadRecord, since: Date, max: number): Promise<boolean>;
}

export function pgLeadStore(pool: Pool): LeadStore {
  return {
    async insertIfUnderLimit(l, since, max) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [l.ipHash]);
        const r = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM "DesignPartnerLead" WHERE "ipHash" = $1 AND "createdAt" >= $2`,
          [l.ipHash, since],
        );
        if (Number(r.rows[0]?.n ?? 0) >= max) {
          await client.query("ROLLBACK");
          return false;
        }
        await client.query(
          `INSERT INTO "DesignPartnerLead" ("id","email","company","source","sender","useCase","ipHash","userAgent","createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [l.id, l.email, l.company, l.source, l.sender, l.useCase, l.ipHash, l.userAgent, l.createdAt],
        );
        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
