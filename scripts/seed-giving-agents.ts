// Seeds the two recurring-giving solicitation agents end-to-end, in draft + paused
// state so nothing sends until reviewed and activated in the UI.
//
// Creates (idempotent, create-only, skips anything already present):
//   SEGMENT DEFINITIONS (rule segments — NOT materialized here; run the
//   materialize-segments cron to populate UserSegment membership):
//     - giving-never-givers     : gift_count_lifetime nexists
//     - giving-has-given        : gift_count_lifetime >= 1
//     - giving-recurring-active : has_recurring_gift is_true   (used as an EXCLUDE)
//   AGENTS (status=draft, sendingPaused=true), each targeting all active personas:
//     1. "Giving: Become a Sower (Never-Givers)"  — LinUCB
//          include giving-never-givers, exclude giving-recurring-active
//          attaches the 7 "Dynamic Handle — Sower Ask $N" templates ($5–$100)
//     2. "Giving: Recurring Upgrade (Past Givers)" — Thompson
//          include giving-has-given, exclude giving-recurring-active
//          attaches the 4 "Dynamic Handle — Recurring (...)" strategy templates
//   Each agent: sower_subscribed + gift_given goals, a 1/week frequency cap, and
//   push variants cloned from the library templates (copying actionFeatures +
//   sourceTemplateId so the sync-template-variants cron keeps them aligned).
//
// Bandit arms (PersonaArmStats / LinUCBArm) are NOT seeded here — the
// select-and-send cron pre-seeds them on first run.
//
// SAFETY: dry-run by default — prints the plan and writes NOTHING. Pass --commit
// to write. prisma targets the .env.local DB (production) per CLAUDE.md.
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

const COMMIT = process.argv.includes("--commit");

type SegmentDef = { name: string; rule: Prisma.InputJsonValue };

// Segments are scoped to funnelStage=dau4 (habitual daily) and narrow the audience.
// Never-givers needs no segment: it's the dau4 funnel-path audience minus givers
// (the agent excludes giving-has-given). recurring ⊂ has-given, so excluding
// has-given drops recurring too.
//
// IMPORTANT — performance: the gift attributes must be indexed for materialization
// to finish within the cron's 60s per-segment timeout. Two PARTIAL expression
// indexes are required on "User":
//   ((attributes->>'gift_count_lifetime')::numeric) WHERE attributes ? 'gift_count_lifetime'
//   ((attributes->>'has_recurring_gift')::boolean)   WHERE attributes ? 'has_recurring_gift'
// AND each rule carries an explicit `exists` condition (below) so the planner can
// match the partial-index predicate — without it the query falls back to a 35M-row
// seq scan and times out (EXPLAIN-confirmed).
const dau4 = { kind: "condition", fieldId: "funnelStage", operator: "in", value: ["dau4"] } as const;
const SEGMENTS: SegmentDef[] = [
  {
    name: "giving-has-given",
    rule: { kind: "group", join: "AND", children: [
      dau4,
      { kind: "condition", fieldId: "gift_count_lifetime", operator: "exists", value: null },
      { kind: "condition", fieldId: "gift_count_lifetime", operator: "gte", value: 1 },
    ] },
  },
  {
    name: "giving-recurring-active",
    rule: { kind: "group", join: "AND", children: [
      dau4,
      { kind: "condition", fieldId: "has_recurring_gift", operator: "exists", value: null },
      { kind: "condition", fieldId: "has_recurring_gift", operator: "is_true", value: null },
    ] },
  },
];

type AgentDef = {
  name: string;
  description: string;
  algorithm: "linucb" | "thompson";
  funnelStage: string;
  includes: string[];
  excludes: string[];
  templateNamePrefix: string; // library template names that start with this go on this agent
};

const AGENTS: AgentDef[] = [
  {
    name: "Giving: Become a Sower (Never-Givers)",
    description: "Asks habitual-daily users with no gift history to start a monthly gift. Experiments on the opening ask ($5–$100) via LinUCB so the per-user context vector learns the best ask for each user and look-alike cohort.",
    algorithm: "linucb",
    funnelStage: "dau4",
    // No include segment: the dau4 funnel-path audience minus givers. recurring ⊂
    // has-given, so excluding has-given removes recurring too.
    includes: [],
    excludes: ["giving-has-given"],
    templateNamePrefix: "Dynamic Handle — Sower Ask",
  },
  {
    name: "Giving: Recurring Upgrade (Past Givers)",
    description: "Asks habitual-daily past one-time givers (not currently recurring) to convert to a monthly gift. Experiments on which gift signal anchors the ask (avg/recent/max/blend) via Thompson Sampling.",
    algorithm: "thompson",
    funnelStage: "dau4",
    includes: ["giving-has-given"],
    excludes: ["giving-recurring-active"],
    templateNamePrefix: "Dynamic Handle — Recurring",
  },
];

const GOALS = [
  { eventName: "sower_subscribed", tier: "best", valueWeight: 1.0, description: "User starts a recurring (Sower) gift — the primary conversion" },
  { eventName: "gift_given", tier: "best", valueWeight: 1.0, description: "User completes a gift (secondary; amount-weighted reward)" },
];

async function main() {
  console.log(`${COMMIT ? "COMMIT" : "DRY-RUN"} — seeding giving agents\n`);

  // ── Segments ───────────────────────────────────────────────────────────────
  for (const s of SEGMENTS) {
    const existing = await prisma.segment.findUnique({ where: { name: s.name } });
    if (existing) { console.log(`  ✓ segment exists: ${s.name}`); continue; }
    if (!COMMIT) { console.log(`  [dry-run] would create segment: ${s.name} ${JSON.stringify(s.rule)}`); continue; }
    await prisma.segment.create({ data: { name: s.name, rule: s.rule } });
    console.log(`  + created segment: ${s.name}`);
  }
  console.log("  NOTE: run the materialize-segments cron to populate membership before activating.\n");

  // ── Target personas (all active) ─────────────────────────────────────────────
  const personas = await prisma.persona.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  console.log(`  ${personas.length} active personas will be targeted by each agent.\n`);

  // ── Library templates (dynamic-handle) ───────────────────────────────────────
  const templates = await prisma.messageVariant.findMany({
    where: { message: { agentId: null, channel: "push" }, category: "giving", subcategory: "dynamic-handle" },
    select: { id: true, name: true, title: true, body: true, cta: true, deeplink: true, category: true, subcategory: true, actionFeatures: true },
  });

  // ── Agents ───────────────────────────────────────────────────────────────────
  for (const a of AGENTS) {
    const existing = await prisma.agent.findFirst({ where: { name: a.name } });
    if (existing) { console.log(`  ✓ agent exists: ${a.name} (${existing.id})`); continue; }

    const variants = templates.filter((t) => t.name.startsWith(a.templateNamePrefix));
    if (variants.length === 0) {
      console.log(`  ! no library templates match "${a.templateNamePrefix}" — run seed-dynamic-handle-variants.ts --commit first. Skipping ${a.name}.`);
      continue;
    }

    if (!COMMIT) {
      console.log(`  [dry-run] would create agent: ${a.name}`);
      console.log(`      algorithm=${a.algorithm}  include=${a.includes}  exclude=${a.excludes}`);
      console.log(`      personas=${personas.length}  goals=${GOALS.map((g) => g.eventName).join(",")}`);
      console.log(`      variants (${variants.length}): ${variants.map((v) => v.name).join(", ")}`);
      continue;
    }

    const agent = await prisma.agent.create({
      data: {
        name: a.name,
        description: a.description,
        algorithm: a.algorithm,
        epsilon: 0.1,
        status: "draft",
        sendingPaused: true,
        funnelStage: a.funnelStage,
        segmentTargeting: { includes: a.includes, excludes: a.excludes },
        goals: { create: GOALS },
        schedulingRule: { create: { frequencyCap: { maxSends: 1, period: "week" } } },
        personaTargets: { create: personas.map((p) => ({ personaId: p.id })) },
        messages: {
          create: {
            name: "Giving Ask",
            channel: "push",
            variants: {
              create: variants.map((v) => ({
                name: v.name,
                title: v.title,
                body: v.body,
                cta: v.cta,
                deeplink: v.deeplink,
                category: v.category,
                subcategory: v.subcategory,
                status: "active",
                sourceTemplateId: v.id,
                ...(v.actionFeatures != null ? { actionFeatures: v.actionFeatures as Prisma.InputJsonValue } : {}),
              })),
            },
          },
        },
      },
    });
    console.log(`  + created agent: ${a.name} (${agent.id}) — draft+paused, ${variants.length} variants, ${personas.length} personas`);
  }

  console.log(`\n${COMMIT ? "Done." : "Re-run with --commit to write."}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
