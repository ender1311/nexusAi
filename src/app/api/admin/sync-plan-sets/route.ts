import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/constant-time-compare";
import { prisma } from "@/lib/db";

const YV_HEADERS = {
  Referer: "http://yvapi.youversionapi.com",
  "X-YouVersion-Client": "youversion",
  "X-YouVersion-App-Platform": "internal",
  "X-YouVersion-App-Version": "1",
};

const BASE = "https://reading-plans.youversionapi.com/3.1";

async function resolveCollectionId(setId: string): Promise<string | null> {
  const u = new URL(`${BASE}/collections/view.json`);
  u.searchParams.set("set_id", setId);
  u.searchParams.set("language_tag", "en");
  const res = await fetch(u.toString(), { headers: YV_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const json = await res.json() as { response: { data?: { id: number } } };
  return json.response.data?.id?.toString() ?? null;
}

async function fetchPlanIds(collectionId: string): Promise<string[]> {
  const u = new URL(`${BASE}/collections/items.json`);
  u.searchParams.append("ids[]", collectionId);
  u.searchParams.set("page", "*");
  const res = await fetch(u.toString(), { headers: YV_HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) return [];
  const json = await res.json() as {
    response: { data: { collections: Array<{ items: Array<{ id: number }> }> } };
  };
  const items = json.response.data.collections[0]?.items ?? [];
  return items.map((item) => String(item.id));
}

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // always require CRON_SECRET — fail closed when unset
  return token != null && constantTimeEqual(token, secret);
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sets = await prisma.planSet.findMany();
  const results: Array<{ setId: string; plans: number; ok: boolean }> = [];

  for (const set of sets) {
    try {
      const collectionId = set.collectionId ?? await resolveCollectionId(set.setId);
      if (!collectionId) { results.push({ setId: set.setId, plans: 0, ok: false }); continue; }

      if (!set.collectionId) {
        await prisma.planSet.update({ where: { setId: set.setId }, data: { collectionId } });
      }

      const planIds = await fetchPlanIds(collectionId);

      const BATCH = 500;
      for (let i = 0; i < planIds.length; i += BATCH) {
        await prisma.planSetMember.createMany({
          data: planIds.slice(i, i + BATCH).map((planId) => ({ planId, setId: set.setId })),
          skipDuplicates: true,
        });
      }

      await prisma.planSet.update({ where: { setId: set.setId }, data: { syncedAt: new Date() } });
      results.push({ setId: set.setId, plans: planIds.length, ok: true });
    } catch (err) {
      console.error("[sync-plan-sets] set sync failed:", set.setId, err);
      results.push({ setId: set.setId, plans: 0, ok: false });
    }
  }

  const total = await prisma.planSetMember.count();
  return NextResponse.json({ ok: true, results, total_members: total });
}
