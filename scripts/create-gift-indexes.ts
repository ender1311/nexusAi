// Creates the partial expression indexes the giving segments need to materialize
// within the cron's 60s per-segment timeout. Without these, the rules fall back to
// a 35M-row seq scan (EXPLAIN-confirmed) and time out.
//
// Partial on key-presence so the index only covers givers (~712K) / recurring
// (~91K), not all 35M rows. The segment rules MUST carry an explicit `exists`
// condition (see seed-giving-agents.ts) so the planner matches the partial
// predicate and uses the index.
//
// CREATE INDEX CONCURRENTLY is non-locking but slow on 35M rows (~15 min each).
// Idempotent (IF NOT EXISTS). Run once against prod. prisma → .env.local.
import pg from "pg";

const INDEXES = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_gift_count_lifetime_idx" ON "User" ((("attributes"->>'gift_count_lifetime')::numeric)) WHERE "attributes" ? 'gift_count_lifetime'`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_has_recurring_gift_idx" ON "User" ((("attributes"->>'has_recurring_gift')::boolean)) WHERE "attributes" ? 'has_recurring_gift'`,
];

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL });
  await client.connect();
  await client.query("SET statement_timeout=0");
  for (const sql of INDEXES) {
    const name = sql.match(/"User_[a-z_]+"/)![0];
    const t0 = Date.now();
    console.log(`building ${name} …`);
    await client.query(sql);
    console.log(`  done (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  await client.end();
  console.log("done");
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
