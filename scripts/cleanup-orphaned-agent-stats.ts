/**
 * One-off cleanup for agent stats orphaned by deletes that predate the
 * DELETE-route fix (PersonaArmStats / UserArmStats / LinUCBArm / FailedBrazeSend /
 * UserAgentAssignment have no cascade FK on agentId, so rows survived their agent).
 *
 * Only deletes rows whose agentId has NO matching Agent — live agents are untouched.
 * Runs against whatever DATABASE_URL is loaded (bun run -> .env.local = PROD).
 *
 *   bun run scripts/cleanup-orphaned-agent-stats.ts            # dry-run (counts only)
 *   bun run scripts/cleanup-orphaned-agent-stats.ts --apply    # delete orphans
 */
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const TABLES = ["PersonaArmStats", "UserArmStats", "LinUCBArm", "FailedBrazeSend", "UserAgentAssignment"];

async function main() {
  console.log(APPLY ? "\n[APPLY] deleting orphaned rows\n" : "\n[DRY-RUN] counts only — pass --apply to delete\n");
  let grandTotal = 0;
  for (const t of TABLES) {
    const countRows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
      `SELECT COUNT(*) AS cnt FROM "${t}" s WHERE NOT EXISTS (SELECT 1 FROM "Agent" a WHERE a."id" = s."agentId")`
    );
    const orphaned = Number(countRows[0]?.cnt ?? 0);
    grandTotal += orphaned;
    if (APPLY && orphaned > 0) {
      const deleted = await prisma.$executeRawUnsafe(
        `DELETE FROM "${t}" s WHERE NOT EXISTS (SELECT 1 FROM "Agent" a WHERE a."id" = s."agentId")`
      );
      console.log(`${t}: deleted ${deleted} orphaned rows`);
    } else {
      console.log(`${t}: ${orphaned} orphaned rows`);
    }
  }
  console.log(`\nTotal orphaned: ${grandTotal}${APPLY ? " (deleted)" : " (dry-run)"}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
