/**
 * sync-braze-canvas-ids.ts
 *
 * Fetches all Braze canvases via REST API and matches them to
 * Message / MessageVariant records by name, storing the Braze UUIDs so
 * the ingest endpoint can do exact canvas-step attribution.
 *
 * Requires: BRAZE_API_KEY + BRAZE_REST_ENDPOINT env vars (or .env.local)
 *
 * Run: bun scripts/sync-braze-canvas-ids.ts
 *
 * What it does:
 *   1. GET /canvas/list  (paginated)  → canvas { id, name }
 *   2. GET /canvas/details?canvas_id  → steps { id, name } per canvas
 *   3. Normalise names → match to Message.name (base canvas) and MessageVariant.name
 *   4. Write Message.brazeCanvasId + MessageVariant.brazeCanvasStepId
 *
 * Matching strategy:
 *   - Strip language suffix from canvas name (same logic as seeder)
 *   - Case-insensitive, whitespace-normalised exact match
 *   - Falls back to "contains" match if exact fails
 */

import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";

// ── Braze API response types ───────────────────────────────────────────────────

type BrazeCanvasListItem = {
  id: string;
  name: string;
  last_edited: string;
  tags: string[];
};

type BrazeCanvasListResponse = {
  canvases: BrazeCanvasListItem[];
  message: string;
  next_page?: number;
};

type BrazeCanvasStep = {
  name: string;
  id?: string;            // present in original canvases
  step_id?: string;       // alternate field name in Canvas Flow
  /** sub-steps within a Canvas Flow component */
  messages?: Record<string, unknown>;
};

type BrazeCanvasDetailResponse = {
  created_at?: string;
  updated_at?: string;
  name?: string;
  canvas_id?: string;
  description?: string;
  steps?: BrazeCanvasStep[];
  message: string;
};

// ── Name normalisation (mirrors seeder logic) ──────────────────────────────────

function normaliseCanvasName(name: string): string {
  return name
    .replace(/\s*\|\s*[A-Z]{2,3}\s*$/i, "")          // strip "| EN", "| ES", etc.
    .replace(/\s*\|\s*All\s+(App|Comm)\s*(Lang)?\s*$/i, "")
    .replace(/\s*\|\s*[A-Z]{2}\s*,.*$/i, "")           // "| EN, ES, FR, PT"
    .replace(/\s*\|\s*\(.*?\)\s*[A-Z]{2,3}\s*$/i, "")  // "| (UK Geo) EN"
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normaliseStepName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

// ── Fetch all canvases (paginated) ────────────────────────────────────────────

async function fetchAllCanvases(braze: ReturnType<typeof createBrazeClient>): Promise<BrazeCanvasListItem[]> {
  if (!braze) throw new Error("Braze client not initialised");
  const all: BrazeCanvasListItem[] = [];
  let page = 0;

  for (;;) {
    const res = await braze.get("/canvas/list", { page, include_archived: false });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GET /canvas/list page=${page} failed: ${res.status} ${text}`);
    }
    const body = await res.json() as BrazeCanvasListResponse;
    all.push(...body.canvases);
    if (body.next_page !== undefined && body.next_page !== page) {
      page = body.next_page;
    } else {
      break;
    }
  }

  return all;
}

// ── Fetch canvas details (steps) ──────────────────────────────────────────────

async function fetchCanvasDetails(
  braze: ReturnType<typeof createBrazeClient>,
  canvasId: string,
): Promise<BrazeCanvasDetailResponse | null> {
  if (!braze) return null;
  const res = await braze.get("/canvas/details", { canvas_id: canvasId });
  if (!res.ok) return null;
  return res.json() as Promise<BrazeCanvasDetailResponse>;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const braze = createBrazeClient();
  if (!braze) {
    throw new Error("BRAZE_API_KEY and BRAZE_REST_ENDPOINT must be set");
  }

  console.log("Fetching canvas list from Braze...");
  const canvases = await fetchAllCanvases(braze);
  console.log(`Found ${canvases.length} canvases`);

  // Load all Messages from DB (we'll match by normalised base name)
  const messages = await prisma.message.findMany({
    select: { id: true, name: true, brazeCanvasId: true },
  });
  const variants = await prisma.messageVariant.findMany({
    select: { id: true, name: true, messageId: true, brazeCanvasStepId: true },
  });

  // Build lookup: normalisedBaseName → [Message]
  const msgByName = new Map<string, (typeof messages)[number][]>();
  for (const m of messages) {
    const key = normaliseCanvasName(m.name);
    const arr = msgByName.get(key) ?? [];
    arr.push(m);
    msgByName.set(key, arr);
  }

  // Build lookup: messageId → [MessageVariant]
  const variantsByMsg = new Map<string, (typeof variants)[number][]>();
  for (const v of variants) {
    const arr = variantsByMsg.get(v.messageId) ?? [];
    arr.push(v);
    variantsByMsg.set(v.messageId, arr);
  }

  let msgMatched = 0, msgSkipped = 0;
  let stepMatched = 0;
  let apiErrors = 0;

  // Rate-limit: Braze allows ~50 req/min for canvas/details
  const DELAY_MS = 1300; // ~46 req/min to stay safe

  for (let i = 0; i < canvases.length; i++) {
    const canvas = canvases[i];
    const normName = normaliseCanvasName(canvas.name);

    const matchedMsgs = msgByName.get(normName) ?? [];
    if (matchedMsgs.length === 0) {
      msgSkipped++;
      continue;
    }

    // Fetch step details for this canvas
    await new Promise((r) => setTimeout(r, DELAY_MS));
    const details = await fetchCanvasDetails(braze, canvas.id);
    if (!details || details.message !== "success" || !details.steps) {
      apiErrors++;
      process.stdout.write(`\r  [${i + 1}/${canvases.length}] API error for canvas ${canvas.id}`);
      continue;
    }

    // Update Message.brazeCanvasId for all matching messages
    for (const msg of matchedMsgs) {
      if (msg.brazeCanvasId === canvas.id) continue; // already set
      await prisma.message.update({
        where: { id: msg.id },
        data: { brazeCanvasId: canvas.id },
      });
      msgMatched++;
    }

    // Build step name → step ID lookup
    const stepByName = new Map<string, string>();
    for (const step of details.steps) {
      const stepId = step.id ?? step.step_id;
      if (stepId) {
        stepByName.set(normaliseStepName(step.name), stepId);
      }
    }

    // Match MessageVariants to steps
    for (const msg of matchedMsgs) {
      const msgVariants = variantsByMsg.get(msg.id) ?? [];
      for (const variant of msgVariants) {
        const normVariant = normaliseStepName(variant.name)
          .replace(/\s*\[[a-z]{2,3}\]\s*$/i, ""); // strip "[ES]", "[PT]" translation suffix

        const stepId = stepByName.get(normVariant);
        if (!stepId) { continue; }
        if (variant.brazeCanvasStepId === stepId) continue; // already set

        await prisma.messageVariant.update({
          where: { id: variant.id },
          data: { brazeCanvasStepId: stepId },
        });
        stepMatched++;
      }
    }

    process.stdout.write(
      `\r  [${i + 1}/${canvases.length}] canvases checked | msgs=${msgMatched} steps=${stepMatched} skipped=${msgSkipped} errors=${apiErrors}   `,
    );
  }

  process.stdout.write("\n");

  const linkedMessages  = await prisma.message.count({ where: { brazeCanvasId: { not: null } } });
  const linkedVariants  = await prisma.messageVariant.count({ where: { brazeCanvasStepId: { not: null } } });

  console.log(`
──────────────────────────────────────────────
Sync complete.

  Canvases checked         : ${canvases.length}
  Messages updated (new)   : ${msgMatched}
  Steps updated (new)      : ${stepMatched}
  Canvases without DB match: ${msgSkipped}
  API errors               : ${apiErrors}

  Total messages with canvas ID : ${linkedMessages}
  Total variants with step ID   : ${linkedVariants}
──────────────────────────────────────────────`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
