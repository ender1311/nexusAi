import type { Pool } from "pg";

export type LeadRecord = {
  id: string; email: string; company: string; source: string; sender: string;
  useCase: string; ipHash: string; userAgent: string; createdAt: Date;
};

export interface LeadStore {
  countSince(ipHash: string, since: Date): Promise<number>;
  insert(lead: LeadRecord): Promise<void>;
}

export function pgLeadStore(pool: Pool): LeadStore {
  return {
    async countSince(ipHash, since) {
      const r = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "DesignPartnerLead" WHERE "ipHash" = $1 AND "createdAt" >= $2`,
        [ipHash, since],
      );
      return Number(r.rows[0]?.n ?? 0);
    },
    async insert(l) {
      await pool.query(
        `INSERT INTO "DesignPartnerLead" ("id","email","company","source","sender","useCase","ipHash","userAgent","createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [l.id, l.email, l.company, l.source, l.sender, l.useCase, l.ipHash, l.userAgent, l.createdAt],
      );
    },
  };
}
