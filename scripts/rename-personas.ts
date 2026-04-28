import { prisma } from "../src/lib/db";

const RENAMES: [string, string][] = [
  ["Anxious Abby", "Anxious"],
  ["Studious Sam", "Studious"],
  ["Connected Callie", "Connected"],
  ["Word-driven William", "Word-driven"],
  ["Plugged-in Priya", "Plugged-in"],
  ["Searching Sebastian", "Searching"],
  ["Family-first Fiona", "Family-first"],
  ["Returning Ryan", "Returning"],
];

async function main() {
  for (const [from, to] of RENAMES) {
    const r = await prisma.persona.updateMany({ where: { name: from }, data: { name: to } });
    console.log(r.count ? `✓ "${from}" → "${to}"` : `✗ not found: "${from}"`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
