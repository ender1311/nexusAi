/**
 * sync-plan-sets.ts
 *
 * Seeds PlanSet definitions and syncs plan memberships from the YouVersion API.
 * Run after schema migrations or when collections need refreshing.
 *
 * Usage: bun run scripts/sync-plan-sets.ts
 *
 * YV API pattern from ../wayfinder/src/lib/server/plan-collections.ts
 */

import { prisma } from "../src/lib/db";

const YV_HEADERS = {
  Referer: "http://yvapi.youversionapi.com",
  "X-YouVersion-Client": "youversion",
  "X-YouVersion-App-Platform": "internal",
  "X-YouVersion-App-Version": "1",
};

const BASE = "https://reading-plans.youversionapi.com/3.1";

// ── Plan set definitions ──────────────────────────────────────────────────────
// personaTag matches Persona.label values in the DB
//
// collectionId: supply directly when the YV Cassi set_id → collection lookup
// doesn't apply (e.g. alfred-sourced collection IDs without a Cassi set_id).
// When present it skips the resolveCollectionId() API call.

const PLAN_SETS: Array<{
  setId: string;
  name: string;
  personaTag: string;
  collectionId?: string;
}> = [
  // Emotion-first — emotional felt-need content
  { setId: "2",   name: "Prayer",               personaTag: "Emotion-first" },
  { setId: "7",   name: "Forgiveness",           personaTag: "Emotion-first" },
  { setId: "24",  name: "Love",                  personaTag: "Emotion-first" },
  { setId: "27",  name: "Healing",               personaTag: "Emotion-first" },
  { setId: "29",  name: "Fear",                  personaTag: "Emotion-first" },
  { setId: "30",  name: "Stress",                personaTag: "Emotion-first" },
  { setId: "33",  name: "Hope",                  personaTag: "Emotion-first" },
  { setId: "35",  name: "Temptation",            personaTag: "Emotion-first" },
  { setId: "353", name: "Encouragement",         personaTag: "Emotion-first" },
  { setId: "357", name: "Peace",                 personaTag: "Emotion-first" },
  // alfred collection 812 — no Cassi set_id; use collectionId directly
  { setId: "col-812",  name: "Anxiety",          personaTag: "Emotion-first", collectionId: "812" },

  // Devotion-first — deep Bible study content
  { setId: "361", name: "Biblical Study",        personaTag: "Devotion-first" },
  { setId: "368", name: "Psalm",                 personaTag: "Devotion-first" },
  { setId: "369", name: "James",                 personaTag: "Devotion-first" },
  { setId: "378", name: "Deuteronomy",           personaTag: "Devotion-first" },
  // alfred collections — no Cassi set_ids
  { setId: "col-1056", name: "Proverbs",         personaTag: "Devotion-first", collectionId: "1056" },
  { setId: "col-1096", name: "Romans",           personaTag: "Devotion-first", collectionId: "1096" },
  { setId: "col-516",  name: "Christian Living", personaTag: "Devotion-first", collectionId: "516"  },

  // Bible-first — whole-Bible / year-long reading
  { setId: "621", name: "Whole Bible",           personaTag: "Bible-first" },
  { setId: "680", name: "Year Long Bible Plan",  personaTag: "Bible-first" },
  { setId: "872", name: "Year Long Bible Plans", personaTag: "Bible-first" },
  { setId: "900", name: "Read Through the Bible",personaTag: "Bible-first" },
  { setId: "911", name: "Through the New Testament", personaTag: "Bible-first" },
  { setId: "915", name: "30 Day Bible Challenge",personaTag: "Bible-first" },
  // alfred collection 7041 — no Cassi set_id
  { setId: "col-7041", name: "The Bible Project", personaTag: "Bible-first", collectionId: "7041" },

  // Social-first — young adults / social content
  { setId: "358", name: "Young Adults",          personaTag: "Social-first" },

  // Seeker — new to faith / seeker content
  { setId: "10",  name: "New to Faith",          personaTag: "Seeker" },
  // Cassi set 253 (alfred: faith collection 1247)
  { setId: "253", name: "Faith",                 personaTag: "Seeker" },
  // alfred collection 1723 — no Cassi set_id
  { setId: "col-1723", name: "Purpose",          personaTag: "Seeker", collectionId: "1723" },

  // Parent — parenting content
  { setId: "43",  name: "Parents",               personaTag: "Parent" },
  { setId: "751", name: "Parenting Plans",       personaTag: "Parent" },
  { setId: "752", name: "Parenting Young Children", personaTag: "Parent" },
  { setId: "753", name: "Parenting Teens/Tweens",   personaTag: "Parent" },
  // alfred collection 1815 — no Cassi set_id
  { setId: "col-1815", name: "Marriage",         personaTag: "Parent", collectionId: "1815" },
];

// ── API helpers ───────────────────────────────────────────────────────────────

async function resolveCollectionId(setId: string): Promise<string | null> {
  const url = `${BASE}/collections/view.json?set_id=${setId}&language_tag=en`;
  const res = await fetch(url, { headers: YV_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const json = await res.json() as { response: { data?: { id: number } } };
  return json.response.data?.id?.toString() ?? null;
}

async function fetchPlanIds(collectionId: string): Promise<string[]> {
  const url = `${BASE}/collections/items.json?ids[]=${collectionId}&page=*`;
  const res = await fetch(url, { headers: YV_HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) return [];
  const json = await res.json() as {
    response: { data: { collections: Array<{ items: Array<{ id: number }> }> } };
  };
  const items = json.response.data.collections[0]?.items ?? [];
  return items.map((item) => String(item.id));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 Syncing plan sets from YouVersion API...\n");

  for (const def of PLAN_SETS) {
    process.stdout.write(`  [${def.setId}] ${def.name} (${def.personaTag}) — `);

    // Upsert PlanSet definition
    const planSet = await prisma.planSet.upsert({
      where: { setId: def.setId },
      update: { name: def.name, personaTag: def.personaTag },
      create: {
        setId: def.setId,
        name: def.name,
        personaTag: def.personaTag,
        // Seed collectionId immediately for alfred-sourced sets
        ...(def.collectionId ? { collectionId: def.collectionId } : {}),
      },
    });

    // Resolve collection ID: use definition override, then cached DB value, then YV API lookup
    const collectionId =
      def.collectionId ??
      planSet.collectionId ??
      await resolveCollectionId(def.setId);
    if (!collectionId) {
      console.log("⚠️  could not resolve collection ID, skipping");
      continue;
    }

    // Persist collectionId if newly resolved via API
    if (!planSet.collectionId && !def.collectionId) {
      await prisma.planSet.update({
        where: { setId: def.setId },
        data: { collectionId },
      });
    }

    // Fetch all plan IDs in this collection
    const planIds = await fetchPlanIds(collectionId);
    process.stdout.write(`${planIds.length} plans — `);

    if (planIds.length === 0) {
      console.log("⚠️  empty, skipping");
      continue;
    }

    // Bulk upsert memberships in batches of 500
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < planIds.length; i += BATCH) {
      const batch = planIds.slice(i, i + BATCH);
      await prisma.planSetMember.createMany({
        data: batch.map((planId) => ({ planId, setId: def.setId })),
        skipDuplicates: true,
      });
      inserted += batch.length;
    }

    // Mark synced
    await prisma.planSet.update({
      where: { setId: def.setId },
      data: { syncedAt: new Date() },
    });

    console.log(`✓ (${inserted} upserted)`);
  }

  const totalSets = await prisma.planSet.count();
  const totalRows = await prisma.planSetMember.count();
  console.log(`\n✅ Done. ${totalSets} sets · ${totalRows} total plan-set memberships`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
