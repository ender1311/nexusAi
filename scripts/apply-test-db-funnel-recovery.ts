/**
 * One-off: apply the exclusive-assignment + funnel-recovery schema changes to the
 * TEST DB only. prisma.config.ts always loads .env.local (production), so we must
 * never `prisma migrate`/`db push` the test DB. Instead run idempotent DDL through
 * the Neon HTTP client using the test DATABASE_URL.
 *
 * Run with: DATABASE_URL="<test-db-url>" bunx tsx scripts/apply-test-db-funnel-recovery.ts
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required (test DB url)");
if (url.includes("ep-old-surf-a4p5os6s")) {
  throw new Error("Refusing to run against the production endpoint.");
}
const sql = neon(url);

async function main() {
  await sql`ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "holdMaxDays" INTEGER NOT NULL DEFAULT 90`;
  await sql`ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "holdMaxSends" INTEGER NOT NULL DEFAULT 24`;
  await sql`ALTER TABLE "UserAgentAssignment" ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3)`;
  await sql`ALTER TABLE "UserAgentAssignment" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3)`;
  await sql`ALTER TABLE "UserAgentAssignment" ADD COLUMN IF NOT EXISTS "releaseReason" TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS "UserAgentAssignment_releasedAt_idx" ON "UserAgentAssignment"("releasedAt")`;

  await sql`
    CREATE TABLE IF NOT EXISTS "FunnelTransition" (
      "id" TEXT PRIMARY KEY,
      "externalUserId" TEXT NOT NULL,
      "fromStage" TEXT NOT NULL,
      "toStage" TEXT NOT NULL,
      "recoveryRank" INTEGER NOT NULL,
      "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "attributedAgentId" TEXT,
      "attributedDecisionId" TEXT
    )`;
  await sql`CREATE INDEX IF NOT EXISTS "FunnelTransition_attributedAgentId_detectedAt_idx" ON "FunnelTransition"("attributedAgentId","detectedAt")`;
  await sql`CREATE INDEX IF NOT EXISTS "FunnelTransition_detectedAt_idx" ON "FunnelTransition"("detectedAt")`;
  await sql`CREATE INDEX IF NOT EXISTS "FunnelTransition_externalUserId_idx" ON "FunnelTransition"("externalUserId")`;
  console.log("Test DB DDL applied.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
