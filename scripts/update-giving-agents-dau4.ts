// One-time update: scope the giving agents + segments to funnelStage=dau4.
//
// Why: an unscoped "never-givers" segment is ~35.2M rows (impractical to
// materialize within the 60s per-segment timeout, and not well-targeted).
// Scoping the segment rules to dau4 lets materialization use the funnelStage
// index (small subset → fast, no gift-attribute index needed), and narrows both
// agents to habitual-daily users.
//
// Applies to the EXISTING objects (agents referenced by ID since they were
// renamed to Lydia / Solomon):
//   - giving-has-given        rule → funnelStage in [dau4] AND gift_count_lifetime >= 1
//   - giving-recurring-active rule → funnelStage in [dau4] AND has_recurring_gift is_true
//   - giving-never-givers     → deleted (never-givers handled via exclude)
//   - Lydia  (never-givers)   → funnelStage=dau4, targeting { includes:[], excludes:[giving-has-given] }
//   - Solomon (single-gift)   → funnelStage=dau4, targeting { includes:[giving-has-given], excludes:[giving-recurring-active] }
//
// Dry-run by default; --commit to write. prisma targets .env.local (prod).
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

const COMMIT = process.argv.includes("--commit");

const NEVER_GIVERS_AGENT_ID = "cmqeibf2m00038yh51t87as0q"; // Lydia
const SINGLE_GIFT_AGENT_ID = "cmqeibfna000o8yh5xgyxsghz"; // Solomon

const dau4 = { kind: "condition", fieldId: "funnelStage", operator: "in", value: ["dau4"] };

const SEGMENT_RULES: Record<string, Prisma.InputJsonValue> = {
  "giving-has-given": { kind: "group", join: "AND", children: [
    dau4,
    { kind: "condition", fieldId: "gift_count_lifetime", operator: "gte", value: 1 },
  ] },
  "giving-recurring-active": { kind: "group", join: "AND", children: [
    dau4,
    { kind: "condition", fieldId: "has_recurring_gift", operator: "is_true", value: null },
  ] },
};

async function main() {
  console.log(`${COMMIT ? "COMMIT" : "DRY-RUN"} — scoping giving agents/segments to dau4\n`);

  for (const [name, rule] of Object.entries(SEGMENT_RULES)) {
    if (!COMMIT) { console.log(`  [dry-run] update segment ${name} → ${JSON.stringify(rule)}`); continue; }
    await prisma.segment.update({ where: { name }, data: { rule, materializedAt: null } });
    console.log(`  + updated segment ${name}`);
  }

  // Agents (by ID — robust to rename). Update targeting + funnelStage before
  // dropping the now-unreferenced never-givers segment.
  const agentUpdates: Array<{ id: string; label: string; funnelStage: string; segmentTargeting: Prisma.InputJsonValue }> = [
    { id: NEVER_GIVERS_AGENT_ID, label: "Lydia (never-givers)", funnelStage: "dau4", segmentTargeting: { includes: [], excludes: ["giving-has-given"] } },
    { id: SINGLE_GIFT_AGENT_ID, label: "Solomon (single-gift)", funnelStage: "dau4", segmentTargeting: { includes: ["giving-has-given"], excludes: ["giving-recurring-active"] } },
  ];
  for (const u of agentUpdates) {
    if (!COMMIT) { console.log(`  [dry-run] update agent ${u.label} → fs=${u.funnelStage} targeting=${JSON.stringify(u.segmentTargeting)}`); continue; }
    await prisma.agent.update({ where: { id: u.id }, data: { funnelStage: u.funnelStage, segmentTargeting: u.segmentTargeting } });
    console.log(`  + updated agent ${u.label}`);
  }

  // Drop the unused never-givers segment + any stray membership.
  if (!COMMIT) {
    console.log(`  [dry-run] delete segment giving-never-givers (+ its UserSegment rows)`);
  } else {
    await prisma.userSegment.deleteMany({ where: { segmentName: "giving-never-givers" } });
    await prisma.segment.deleteMany({ where: { name: "giving-never-givers" } });
    console.log(`  + deleted segment giving-never-givers`);
  }

  console.log(`\n${COMMIT ? "Done." : "Re-run with --commit to write."}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
