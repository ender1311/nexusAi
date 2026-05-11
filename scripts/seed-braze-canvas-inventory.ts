/**
 * seed-braze-canvas-inventory.ts
 *
 * Seeds the Nexus DB from the Braze Push Canvas Inventory.
 * Supports two sources (checked in order):
 *   1. Notion REST API — set NOTION_TOKEN env var
 *   2. CSV export      — set CSV_PATH env var (or use default path below)
 *
 * Notion database: https://www.notion.so/9d809a314e7547bf9d3c57e16e39abaf
 * (Push Canvases table on the Braze Push Canvas Inventory page)
 *
 * Run:
 *   NOTION_TOKEN=secret_xxx bun scripts/seed-braze-canvas-inventory.ts
 *   bun scripts/seed-braze-canvas-inventory.ts  # falls back to CSV
 *
 * What it creates:
 *   - One draft Agent per category (status="draft", named "[Library] Category")
 *   - One Message per unique canvas base name, linked to the category agent
 *   - One MessageVariant per row with:
 *       category / subcategory / actionFeatures populated
 *       non-English variants linked to English source via sourceTemplateId
 */

import fs from "fs";
import path from "path";
import { createInterface } from "readline";
import { prisma } from "@/lib/db";

// ── Notion config ──────────────────────────────────────────────────────────────
// Database ID from: https://www.notion.so/9d809a314e7547bf9d3c57e16e39abaf
// Page: Braze Push Canvas Inventory — Push Titles & Bodies
// Collection ID: collection://6b9793c9-fcf6-476e-9be2-901d941aebb3
const NOTION_DATABASE_ID = "9d809a314e7547bf9d3c57e16e39abaf";

// ── CSV path (fallback) ────────────────────────────────────────────────────────
const CSV_PATH = path.resolve(
  process.env.CSV_PATH ??
  "/Users/danluk/Downloads/Private & Shared 4/Push Canvases 9d809a314e7547bf9d3c57e16e39abaf_all.csv"
);

// ── Notion REST API types ──────────────────────────────────────────────────────
type NotionRichText = { plain_text: string };
type NotionTitleProp = { title: NotionRichText[] };
type NotionRichTextProp = { rich_text: NotionRichText[] };
type NotionPageProperties = {
  "Canvas Name": NotionTitleProp;
  "Push Title":  NotionRichTextProp;
  "Push Body":   NotionRichTextProp;
  "Step":        NotionRichTextProp;
  "Last Edited": NotionRichTextProp;
};
type NotionPage = { properties: NotionPageProperties };
type NotionQueryResponse = {
  results:    NotionPage[];
  has_more:   boolean;
  next_cursor: string | null;
};

// ── Notion source ──────────────────────────────────────────────────────────────
async function fetchFromNotion(): Promise<Array<Record<string, string>>> {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN not set");

  const rows: Array<Record<string, string>> = [];
  let cursor: string | null = null;

  do {
    const reqBody: Record<string, unknown> = { page_size: 100 };
    if (cursor) reqBody.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as NotionQueryResponse;

    for (const page of data.results) {
      const p = page.properties;
      rows.push({
        "Canvas Name": p["Canvas Name"]?.title?.[0]?.plain_text ?? "",
        "Push Title":  p["Push Title"]?.rich_text?.[0]?.plain_text ?? "",
        "Push Body":   p["Push Body"]?.rich_text?.[0]?.plain_text ?? "",
        "Step":        p["Step"]?.rich_text?.[0]?.plain_text ?? "",
        "Last Edited": p["Last Edited"]?.rich_text?.[0]?.plain_text ?? "",
      });
    }

    cursor = data.has_more ? data.next_cursor : null;
    process.stdout.write(`\r  Fetched ${rows.length} rows from Notion...`);
  } while (cursor);

  process.stdout.write("\n");
  return rows;
}

// ── CSV parser (handles quoted fields with embedded commas/newlines) ───────────
async function parseCSV(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const rl = createInterface({ input: fs.createReadStream(filePath, "utf8"), crlfDelay: Infinity });

  let headers: string[] = [];
  let partial = "";
  let isFirstLine = true;

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let inQuote = false;
    let field = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { field += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        fields.push(field); field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field);
    return fields;
  };

  for await (const rawLine of rl) {
    const line = partial ? partial + "\n" + rawLine : rawLine;
    // Count unescaped quotes — if odd, the line is split across a CSV field
    const quoteCount = (line.match(/"/g) ?? []).length;
    if (quoteCount % 2 !== 0) { partial = line; continue; }
    partial = "";

    // Strip BOM on first line
    const cleanLine = isFirstLine ? line.replace(/^\uFEFF/, "") : line;
    isFirstLine = false;

    if (!cleanLine.trim()) continue;
    const fields = parseLine(cleanLine);

    if (headers.length === 0) { headers = fields; continue; }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (fields[i] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

// ── Category taxonomy ──────────────────────────────────────────────────────────
type Category =
  | "reading_plan_habit"
  | "reading_plan_nurture"
  | "giving"
  | "seasonal_holiday"
  | "re_engagement"
  | "onboarding"
  | "search_discovery"
  | "featured_editorial"
  | "regional"
  | "app_product"
  | "uncategorized";

// Ordered most-specific → least-specific. First match wins.
const CATEGORY_RULES: Array<{ pattern: RegExp; category: Category }> = [
  // Reading plan daily loops (Reward / Remind cadence, BiOY workflow, streak)
  { pattern: /daily reward|reward.?remind|remind.?reward|bioy\s*(workflow|reward)|long plans.*reward|plan.*reward\s*push|reward\s*push.*plan/i,                category: "reading_plan_habit"   },
  // Plan nurture sequences (progress, engagement, BiOY engagement)
  { pattern: /plans nurture|bioy engagement|plan.*nurture|nurture.*plan|bioy.*engag/i,                                                                          category: "reading_plan_nurture" },
  // Giving / generosity campaigns
  { pattern: /giving|sower.*welcome|sowers.*welcome/i,                                                                                                          category: "giving"               },
  // Seasonal / holiday
  { pattern: /easter|resurrection|christmas|advent|verse of the year|páscoa|pascoa|post.?easter|good friday|lent|holy week|thanksgiving/i,                     category: "seasonal_holiday"     },
  // Re-engagement: DAU4, WAU→DAU4, Habitual MAU, UXR, lapsed
  { pattern: /\bdau4\b|wau.?to.?dau|habitual mau|uxr launch|lapsed.*push|push.*lapsed|activation.*push|push.*activation|re.?engag|new download|account creat/i, category: "re_engagement"        },
  // Onboarding: new user, welcome, BAL onboarding
  { pattern: /onboarding|welcome series|getting started/i,                                                                                                      category: "onboarding"           },
  // Search-driven / topic discovery campaigns (anxiety, healing, hope, etc.)
  { pattern: /search\s*[-–]\s*\w|search.*plan|topic.*push|push.*topic/i,                                                                                        category: "search_discovery"     },
  // Featured & editorial content pushes
  { pattern: /featured plan|editorial|mid.?month|share.*plan|faith plan/i,                                                                                      category: "featured_editorial"   },
  // Regional / geo-targeted
  { pattern: /east africa|west africa|africa.*touch|good neighbor|south asia|latin america|uk geo|mothers day uk/i,                                             category: "regional"             },
  // App & product (BAL, surveys, milestone, milestone)
  { pattern: /\bbal\b|bible app lite|connectivity survey|milestone|badge|streak|bafk|100 million|prayer.*push|push.*prayer/i,                                   category: "app_product"          },
];

const CATEGORY_META: Record<Category, { label: string; description: string }> = {
  reading_plan_habit: {
    label:       "Reading Plan Habit",
    description: "Daily reading loops — Reward/Remind cadence, BiOY workflow, streak reinforcement. Targets habitual and WAU users.",
  },
  reading_plan_nurture: {
    label:       "Reading Plan Nurture",
    description: "Plan progress and encouragement sequences. Keeps users engaged through long or multi-day reading plans.",
  },
  giving: {
    label:       "Giving & Generosity",
    description: "Donation campaigns — recurring givers, occasional givers, non-givers, and Sowers welcome series.",
  },
  seasonal_holiday: {
    label:       "Seasonal & Holiday",
    description: "Time-bound campaigns: Easter, Resurrection, Christmas/Advent, Lent, Holy Week, Verse of the Year.",
  },
  re_engagement: {
    label:       "Re-engagement",
    description: "Win-back and activation flows for lapsed, DAU4, and MAU users. WAU→DAU4 upgrade funnel and new downloads.",
  },
  onboarding: {
    label:       "Onboarding",
    description: "First-impression sequences for new users and Bible App Lite installs. Sets habits and introduces core features.",
  },
  search_discovery: {
    label:       "Search & Discovery",
    description: "Topic-driven campaigns (Anxiety, Hope, Healing, Peace, etc.) aligned with in-app search behaviour.",
  },
  featured_editorial: {
    label:       "Featured & Editorial",
    description: "Staff picks, featured plans, editorial pushes, and faith-sharing plan campaigns.",
  },
  regional: {
    label:       "Regional Campaigns",
    description: "Geo-targeted campaigns for specific regions (East Africa, UK, etc.) and community initiatives.",
  },
  app_product: {
    label:       "App & Product",
    description: "Bible App Lite (BAL), prayer feature, badge/milestone, surveys, and major milestone announcements.",
  },
  uncategorized: {
    label:       "Uncategorized",
    description: "Canvases that don't match a known category. Review for manual re-classification.",
  },
};

function classifyCanvas(name: string): Category {
  for (const { pattern, category } of CATEGORY_RULES) {
    if (pattern.test(name)) return category;
  }
  return "uncategorized";
}

// ── Language detection ─────────────────────────────────────────────────────────
function detectLanguage(canvasName: string): string {
  // "| EN", "| ES", "| PT", "| FR", "| TL", etc.
  const suffix = canvasName.match(/\|\s*([A-Z]{2,3})\s*$/)?.[1]?.toLowerCase();
  if (suffix) return suffix;
  // "| All App Lang", "| All Comm Lang", "| All Comm"
  if (/\|\s*All\s+(App|Comm)/i.test(canvasName)) return "all";
  // Portuguese campaign pattern
  if (/\[PT CAMPAIGN|PÓS PÁSCOA/i.test(canvasName)) return "pt";
  // "| EN, ES, FR, PT" — treat as English master
  if (/\|\s*EN\s*,/i.test(canvasName)) return "en";
  return "en";
}

// ── Base canvas name (strips language suffix for translation grouping) ──────────
function baseCanvas(name: string): string {
  return name
    .replace(/\s*\|\s*[A-Z]{2,3}\s*$/i, "")
    .replace(/\s*\|\s*All\s+(App|Comm)\s*(Lang)?\s*$/i, "")
    .replace(/\s*\|\s*[A-Z]{2}\s*,.*$/i, "")       // "| EN, ES, FR, PT"
    .replace(/\s*\|\s*\(.*?\)\s*[A-Z]{2,3}\s*$/i, "") // "| (UK Geo) EN"
    .trim();
}

// ── Subcategory from step name ─────────────────────────────────────────────────
function getSubcategory(step: string): string {
  const s = step.toLowerCase();
  if (s.includes("- reward") || /^push\s*\d*\s*-?\s*reward/i.test(step)) return "reward";
  if (s.includes("- remind") || /^push\s*\d*\s*-?\s*remind/i.test(step)) return "remind";
  if (s.includes("new user"))         return "new_user";
  if (s.includes("lapsed"))           return "lapsed";
  if (s.includes("mau"))              return "mau";
  if (s.includes("occasional giver")) return "occasional_giver";
  if (s.includes("non giver") || s.includes("non-giver")) return "non_giver";
  if (s.includes("recurring giver"))  return "recurring_giver";
  if (s.includes("connected"))        return "connected";
  if (s.includes("wau"))              return "wau";
  if (s.includes("verse text") || s.includes("verse of the day")) return "verse";
  if (s.includes("control"))          return "control";
  if (s.includes("prayer"))           return "prayer";
  if (s.includes("test"))             return "test";
  if (/^[0-9a-f-]{36}$/i.test(step)) return "general"; // UUID step
  const cleaned = s.replace(/^(push|step)\s*\d*\s*[-–a-z]*\s*/i, "").replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 40);
  return cleaned || "general";
}

// ── Action features inference ──────────────────────────────────────────────────
function inferActionFeatures(title: string, body: string) {
  const combined = `${title} ${body}`;
  let tone: string;
  if (/miss you|come back|we.d love|been a while|we.re glad|welcome back/i.test(combined))  tone = "empathy";
  else if (/don.t miss|last chance|today only|limited|expires|ends tonight/i.test(combined)) tone = "urgency";
  else if (/congratulations|completed|milestone|achievement|you did it|streak|badge/i.test(combined)) tone = "milestone";
  else if (/\?/.test(combined))                                                               tone = "question";
  else                                                                                         tone = "inspirational";

  return {
    tone,
    hasPersonalization: /\{\{|first_name|custom_attribute/i.test(combined),
    hasCTA:             /tap|open|read|start|join|give|check out|learn more|discover/i.test(combined.toLowerCase()),
    messageLengthBucket: body.length < 60 ? "short" : body.length < 120 ? "medium" : "long",
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  let rawRows: Array<Record<string, string>>;

  if (process.env.NOTION_TOKEN) {
    console.log(`Source: Notion REST API (database ${NOTION_DATABASE_ID})`);
    rawRows = await fetchFromNotion();
  } else {
    if (!fs.existsSync(CSV_PATH)) {
      throw new Error(
        `CSV not found at: ${CSV_PATH}\n` +
        `Set CSV_PATH env var to override, or set NOTION_TOKEN to pull from Notion.`
      );
    }
    console.log(`Source: CSV at ${CSV_PATH}`);
    rawRows = await parseCSV(CSV_PATH);
  }

  // Filter garbage rows
  const rows = rawRows.filter((r) => {
    const body = r["Push Body"] ?? "";
    return r["Canvas Name"] && body && body !== "%}" && body.length > 2;
  });

  console.log(`Loaded ${rows.length} valid rows from ${rawRows.length} total`);

  // ── Group by category ──────────────────────────────────────────────────────
  const byCategory = new Map<Category, typeof rows>();
  for (const row of rows) {
    const cat = classifyCanvas(row["Canvas Name"]);
    const bucket = byCategory.get(cat) ?? [];
    bucket.push(row);
    byCategory.set(cat, bucket);
  }

  console.log("\nCategory breakdown:");
  for (const [cat, catRows] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${CATEGORY_META[cat].label.padEnd(26)} ${String(catRows.length).padStart(4)} rows`);
  }

  // ── Create / find library agents ───────────────────────────────────────────
  console.log("\nUpserting library agents...");
  const agentByCat = new Map<Category, string>();

  for (const cat of byCategory.keys()) {
    const { label, description } = CATEGORY_META[cat];
    const libraryName = `[Library] ${label}`;
    let agent = await prisma.agent.findFirst({ where: { name: libraryName } });
    if (!agent) {
      agent = await prisma.agent.create({
        data: { name: libraryName, description, status: "draft", algorithm: "thompson", funnelStage: "wau" },
      });
      console.log(`  + ${libraryName}`);
    } else {
      console.log(`  ✓ ${libraryName}`);
    }
    agentByCat.set(cat, agent.id);
  }

  // ── Seed Messages + Variants ───────────────────────────────────────────────
  // Two-pass per canvas:
  //   Pass 1 → English / ALL variants (source templates)
  //   Pass 2 → translations, linked to English via sourceTemplateId
  const englishVariantIds = new Map<string, string>(); // `baseCanvas||step` → variantId
  let msgCount = 0, varCount = 0, skipCount = 0;

  for (const [cat, catRows] of byCategory) {
    const agentId = agentByCat.get(cat)!;

    // Group by base canvas name
    const byBase = new Map<string, typeof catRows>();
    for (const row of catRows) {
      const base = baseCanvas(row["Canvas Name"]);
      const bucket = byBase.get(base) ?? [];
      bucket.push(row);
      byBase.set(base, bucket);
    }

    for (const [base, canvasRows] of byBase) {
      // Find or create Message
      let message = await prisma.message.findFirst({ where: { agentId, name: base } });
      if (!message) {
        message = await prisma.message.create({
          data: { agentId, name: base, channel: "push", testedVariables: [] },
        });
        msgCount++;
      }

      // Pass 1: English / ALL
      for (const row of canvasRows) {
        const lang = detectLanguage(row["Canvas Name"]);
        if (lang !== "en" && lang !== "all") continue;

        const stepName = row["Step"] || "Push";
        if (await prisma.messageVariant.findFirst({ where: { messageId: message.id, name: stepName } })) {
          skipCount++; continue;
        }

        const variant = await prisma.messageVariant.create({
          data: {
            messageId:      message.id,
            name:           stepName,
            title:          row["Push Title"] || null,
            body:           row["Push Body"],
            category:       cat,
            subcategory:    getSubcategory(stepName),
            status:         "active",
            actionFeatures: inferActionFeatures(row["Push Title"] ?? "", row["Push Body"] ?? ""),
          },
        });
        englishVariantIds.set(`${base}||${stepName}`, variant.id);
        varCount++;
      }

      // Pass 2: Translations
      for (const row of canvasRows) {
        const lang = detectLanguage(row["Canvas Name"]);
        if (lang === "en" || lang === "all") continue;

        const stepName  = row["Step"] || "Push";
        const varName   = `${stepName} [${lang.toUpperCase()}]`;
        if (await prisma.messageVariant.findFirst({ where: { messageId: message.id, name: varName } })) {
          skipCount++; continue;
        }

        const sourceTemplateId = englishVariantIds.get(`${base}||${stepName}`) ?? null;
        await prisma.messageVariant.create({
          data: {
            messageId:      message.id,
            name:           varName,
            title:          row["Push Title"] || null,
            body:           row["Push Body"],
            category:       cat,
            subcategory:    getSubcategory(stepName),
            status:         "active",
            sourceTemplateId,
            actionFeatures: inferActionFeatures(row["Push Title"] ?? "", row["Push Body"] ?? ""),
          },
        });
        varCount++;
      }
    }

    process.stdout.write(`\r  [${CATEGORY_META[cat].label}] messages=${msgCount} variants=${varCount} skipped=${skipCount}   `);
  }

  process.stdout.write("\n");

  const linkedTranslations = await prisma.messageVariant.count({ where: { sourceTemplateId: { not: null } } });
  console.log(`
──────────────────────────────────────────────
Seeding complete.

  CSV rows processed   : ${rows.length}
  Messages created     : ${msgCount}
  Variants created     : ${varCount}
  Variants skipped     : ${skipCount} (already existed)
  Translations linked  : ${linkedTranslations} (sourceTemplateId set)
──────────────────────────────────────────────`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
