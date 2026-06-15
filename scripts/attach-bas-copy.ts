// Attaches a curated 5-variant BAS subset to both giving agents (clones with
// actionFeatures + deeplink + sourceTemplateId). Covers the campaign's three
// angles (identity / mechanics / global need), both routes (give + Sowers), and
// the two tokenized asks. Idempotent. Dry-run by default; --commit to write.
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

const COMMIT = process.argv.includes("--commit");
const AGENT_IDS = ["cmqeibf2m00038yh51t87as0q", "cmqeibfna000o8yh5xgyxsghz"]; // Lydia, Solomon
const NAMES = [
  "BAS Push — Consistently in the Word",
  "BAS Push — Takes 60 seconds",
  "BAS Push — Powerful way to make an impact",
  "BAS Modal — You're invited",
  "BAS Push — World searching for answers",
];

async function main() {
  console.log(`${COMMIT ? "COMMIT" : "DRY-RUN"} — attaching ${NAMES.length} BAS variants to ${AGENT_IDS.length} agents\n`);
  const templates = await prisma.messageVariant.findMany({
    where: { message: { agentId: null }, name: { in: NAMES } },
    select: { id: true, name: true, title: true, body: true, cta: true, deeplink: true, category: true, subcategory: true, actionFeatures: true },
  });
  const tplByName = new Map(templates.map((t) => [t.name, t]));

  for (const agentId of AGENT_IDS) {
    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId }, select: { name: true } });
    const msg = await prisma.message.findFirst({ where: { agentId, channel: "push" }, select: { id: true, variants: { select: { name: true } } } });
    if (!msg) { console.log(`  ! ${agent.name}: no push message`); continue; }
    const existing = new Set(msg.variants.map((v) => v.name));
    for (const name of NAMES) {
      const t = tplByName.get(name);
      if (!t) { console.log(`  ! template not found: ${name}`); continue; }
      if (existing.has(name)) { console.log(`  skip (on ${agent.name}): ${name}`); continue; }
      if (!COMMIT) { console.log(`  [dry-run] attach to ${agent.name}: ${name}`); continue; }
      await prisma.messageVariant.create({
        data: {
          messageId: msg.id, name: t.name, title: t.title, body: t.body, cta: t.cta, deeplink: t.deeplink,
          category: t.category, subcategory: t.subcategory, status: "active", sourceTemplateId: t.id,
          ...(t.actionFeatures != null ? { actionFeatures: t.actionFeatures as Prisma.InputJsonValue } : {}),
        },
      });
      console.log(`  + attached to ${agent.name}: ${name}`);
    }
  }
  console.log(`\n${COMMIT ? "Done." : "Re-run with --commit to write."}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
