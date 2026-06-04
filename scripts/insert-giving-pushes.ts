// Bulk-insert the curated giving push library (docs/json/giving-push-library.json) into
// the push copy library as MessageVariant rows under the LIBRARY_AGENT_NAME agent.
//
// SAFETY: dry-run by default — prints the plan and writes NOTHING. Pass --commit to
// insert. Idempotent: skips any entry whose name already exists under the library
// agent, so re-runs never duplicate. Create-only — never updates or deletes.
// prisma here targets the .env.local DB (production) per CLAUDE.md, so review the
// dry-run before passing --commit.
import * as fs from "fs";
import * as path from "path";
import { prisma } from "@/lib/db";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";

type Entry = {
  name: string;
  category: string;
  subcategory: string | null;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
};

const COMMIT = process.argv.includes("--commit");
const JSON_PATH = path.join(process.cwd(), "docs", "json", "giving-push-library.json");

async function main() {
  const raw = fs.readFileSync(JSON_PATH, "utf-8");
  const entries = JSON.parse(raw) as Entry[];
  console.log(`Loaded ${entries.length} entries from ${JSON_PATH}`);

  // Find or create the library agent (mirrors POST /api/push-library).
  let agent = await prisma.agent.findFirst({ where: { name: LIBRARY_AGENT_NAME } });
  if (!agent) {
    if (!COMMIT) {
      console.log(`[dry-run] would create library agent "${LIBRARY_AGENT_NAME}"`);
    } else {
      agent = await prisma.agent.create({
        data: {
          name: LIBRARY_AGENT_NAME,
          description: "Canonical push copy templates. Never used for decisions — status stays draft.",
          algorithm: "thompson",
          epsilon: 0.1,
          status: "draft",
          funnelStage: "connected",
        },
      });
      console.log(`Created library agent ${agent.id}`);
    }
  }

  // Find or create the "giving" category message.
  let message = agent
    ? await prisma.message.findFirst({
        where: { agentId: agent.id, variants: { some: { category: "giving" } } },
      })
    : null;
  if (!message) {
    if (!COMMIT) {
      console.log(`[dry-run] would create message "giving Templates"`);
    } else {
      message = await prisma.message.create({
        data: { agentId: agent!.id, name: "giving Templates", channel: "push" },
      });
      console.log(`Created message ${message.id}`);
    }
  }

  // Existing names under the library agent → skip to stay idempotent.
  const existing = agent
    ? await prisma.messageVariant.findMany({
        where: { message: { agentId: agent.id } },
        select: { name: true },
      })
    : [];
  const existingNames = new Set(existing.map((v) => v.name));

  let created = 0;
  let skipped = 0;
  for (const e of entries) {
    if (existingNames.has(e.name)) {
      skipped++;
      continue;
    }
    if (!COMMIT) {
      console.log(`[dry-run] would insert [${e.subcategory}] ${e.name}`);
      created++;
      continue;
    }
    await prisma.messageVariant.create({
      data: {
        messageId: message!.id,
        name: e.name,
        title: e.title?.trim() || null,
        body: e.body.trim(),
        deeplink: e.deeplink?.trim() || null,
        cta: e.cta?.trim() || null,
        category: "giving",
        subcategory: e.subcategory?.trim() || null,
        status: "active",
      },
    });
    created++;
  }

  console.log(
    `${COMMIT ? "Inserted" : "[dry-run] would insert"} ${created}, skipped ${skipped} (already present).`
  );
  if (!COMMIT) console.log("Re-run with --commit to write.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
