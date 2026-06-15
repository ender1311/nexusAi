// Attaches a curated subset of the giving copy library to the two giving agents
// (clones onto each agent's "Giving Ask" message, copying actionFeatures +
// subcategory + sourceTemplateId — same as the picker/attach path).
//
// Lydia (never-givers) and Solomon (past-givers) each get the 4 tokenized copies
// + 3 audience-strongest. Idempotent by name within the message. Dry-run by
// default; --commit to write. prisma → .env.local (prod).
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

const COMMIT = process.argv.includes("--commit");
const LYDIA = "cmqeibf2m00038yh51t87as0q";   // never-givers
const SOLOMON = "cmqeibfna000o8yh5xgyxsghz"; // past-givers

const TOKENIZED = [
  "Giving Copy — Reach the world",
  "Giving Copy — What happens when I give",
  "Giving Copy — Love in action",
  "Giving Copy — 195 countries",
];
const ATTACH: Record<string, string[]> = {
  [LYDIA]: [...TOKENIZED, "Giving Copy — Won't stop", "Giving Copy — You're invited (Sowers)", "Giving Copy — Almost a billion"],
  [SOLOMON]: [...TOKENIZED, "Giving Copy — Not done yet", "Giving Copy — Generosity made this happen", "Giving Copy — Mission needs you"],
};

async function main() {
  console.log(`${COMMIT ? "COMMIT" : "DRY-RUN"} — attaching curated giving copy\n`);
  const allNames = [...new Set(Object.values(ATTACH).flat())];
  const templates = await prisma.messageVariant.findMany({
    where: { message: { agentId: null }, name: { in: allNames } },
    select: { id: true, name: true, title: true, body: true, cta: true, deeplink: true, category: true, subcategory: true, actionFeatures: true },
  });
  const tplByName = new Map(templates.map((t) => [t.name, t]));

  for (const [agentId, names] of Object.entries(ATTACH)) {
    const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId }, select: { name: true } });
    const msg = await prisma.message.findFirst({ where: { agentId, channel: "push" }, select: { id: true, variants: { select: { name: true } } } });
    if (!msg) { console.log(`  ! ${agent.name}: no push message`); continue; }
    const existing = new Set(msg.variants.map((v) => v.name));
    for (const name of names) {
      const t = tplByName.get(name);
      if (!t) { console.log(`  ! template not found: ${name}`); continue; }
      if (existing.has(name)) { console.log(`  skip (already on ${agent.name}): ${name}`); continue; }
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
