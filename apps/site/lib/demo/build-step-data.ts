// Pure builders for the demo walkthrough. Each step calls the real engine and
// content-core code on the Lumen sample data; nothing here touches the network.
import { computeFeatureVector } from "@engine/feature-vector";
import { ThompsonSampling } from "@engine/thompson-sampling";
import {
  applyFieldMapping,
  brazeCatalogLiquid,
  buildActivationProperties,
  DEFAULT_MAPPINGS,
  type ContentItem,
  type FieldMapping,
} from "@content-core/index";
import { DEMO_SOURCES, FEATURE_LABELS, LUMEN_CONTENT, LUMEN_PERSONAS, LUMEN_USER, type DemoSource } from "@site/content/demo-lumen";
import { mulberry32 } from "@site/lib/simulator/rng";

export { DEMO_SOURCES };

export const DEMO_AS_OF = new Date("2026-10-15T12:00:00Z");
const DEFAULT_SEED = 42;

export type ArmStats = { alpha: number; beta: number };

const ARM_STATS_BY_POSITION: ArmStats[] = [
  { alpha: 18, beta: 42 },
  { alpha: 9, beta: 51 },
  { alpha: 6, beta: 34 },
  { alpha: 3, beta: 37 },
];
const ARM_REFS = [
  ["lumen-breathing", "tip_1"],
  ["lumen-sleep", "tip_2"],
  ["lumen-streak", "tip_3"],
  ["lumen-upgrade", "tip_4"],
] as const;

/**
 * Keyed by externalRef (the Braze catalog uses tip_N ids, every other source
 * uses lumen-*). Deliberately uneven so Thompson has a believable lead.
 */
export const INITIAL_ARM_STATS: Record<string, ArmStats> = Object.fromEntries(
  ARM_REFS.flatMap((refs, i) => refs.map((ref) => [ref, ARM_STATS_BY_POSITION[i]!] as const)),
);

export function stepIngest(): {
  warehouseRow: unknown;
  hightouchRecord: unknown;
  ingestRequest: { method: "POST"; path: "/api/ingest/users"; body: unknown };
} {
  const warehouseRow = {
    user_id: LUMEN_USER.externalId,
    plan: LUMEN_USER.attributes.plan,
    locale: LUMEN_USER.attributes.locale,
    sessions_7d: LUMEN_USER.attributes.sessions_7d,
    last_open_hour: LUMEN_USER.attributes.last_open_hour,
    days_since_last_open: LUMEN_USER.attributes.days_since_last_open,
    streak_days: LUMEN_USER.attributes.streak_days,
  };
  const { user_id: externalUserId, ...attributes } = warehouseRow;
  const hightouchRecord = { external_user_id: externalUserId, attributes };
  return {
    warehouseRow,
    hightouchRecord,
    ingestRequest: { method: "POST", path: "/api/ingest/users", body: { users: [hightouchRecord] } },
  };
}

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum);
}

export function stepFeatures(): {
  vector: number[];
  labelled: { label: string; value: number }[];
  persona: { id: string; label: string; distance: number };
} {
  const vector = computeFeatureVector({
    totalDecisions: LUMEN_USER.totalDecisions,
    totalConversions: LUMEN_USER.totalConversions,
    totalReward: LUMEN_USER.totalReward,
    channelStats: LUMEN_USER.channelStats,
    hourlyStats: LUMEN_USER.hourlyStats,
    dailyStats: LUMEN_USER.dailyStats,
    attributes: LUMEN_USER.attributes,
    asOf: DEMO_AS_OF,
  });
  const labelled = vector.map((value, i) => ({ label: FEATURE_LABELS[i]!, value }));
  const nearest = LUMEN_PERSONAS
    .map((p) => ({ id: p.id, label: p.label, distance: euclidean(vector, p.centroid) }))
    .reduce((best, p) => (p.distance < best.distance ? p : best));
  return { vector, labelled, persona: nearest };
}

function mapRecords(records: unknown[], mapping: FieldMapping, channel: "push" | "content_card"): ContentItem[] {
  return records.map((record, i) => {
    const result = applyFieldMapping(record, mapping, { channel });
    if ("error" in result) throw new Error(`Sample record ${i} failed to map: ${result.error}`);
    return result.item;
  });
}

function sourceRecords(source: DemoSource): { records: unknown[]; mapping: FieldMapping | null } {
  switch (source) {
    case "contentful": return { records: LUMEN_CONTENT.contentful, mapping: DEFAULT_MAPPINGS.contentful };
    case "sanity": return { records: LUMEN_CONTENT.sanity, mapping: DEFAULT_MAPPINGS.sanity };
    case "generic-json": return { records: LUMEN_CONTENT.genericJson.record, mapping: LUMEN_CONTENT.genericJson.mapping };
    case "braze-catalog": return { records: LUMEN_CONTENT.brazeCatalog, mapping: DEFAULT_MAPPINGS["braze-catalog"] };
    case "nexus-library": return { records: LUMEN_CONTENT.nexusLibrary, mapping: null };
  }
}

export function stepContent(source: DemoSource): {
  sourceRecord: unknown;
  mapping: FieldMapping | null;
  item: ContentItem;
  items: ContentItem[];
} {
  const { records, mapping } = sourceRecords(source);
  const items = mapping
    ? mapRecords(records, mapping, source === "braze-catalog" ? "content_card" : "push")
    : LUMEN_CONTENT.nexusLibrary;
  return { sourceRecord: records[0], mapping, item: items[0]!, items };
}

export function stepDecide(
  source: DemoSource,
  seed?: number,
): {
  chosen: ContentItem;
  arms: { item: ContentItem; estimate: number; uncertainty: number }[];
} {
  const { items } = stepContent(source);
  const statsFor = (item: ContentItem): ArmStats => {
    const stats = INITIAL_ARM_STATS[item.externalRef];
    if (!stats) throw new Error(`No initial arm stats for ${item.externalRef}`);
    return stats;
  };
  const banditArms = items.map((item) => {
    const { alpha, beta } = statsFor(item);
    return { id: item.externalRef, stats: { alpha, beta, tries: alpha + beta - 2, wins: alpha - 1 } };
  });

  // The engine draws from Math.random: swap in a seeded stream, always restore.
  const original = Math.random;
  Math.random = mulberry32(seed ?? DEFAULT_SEED);
  let variantId: string;
  try {
    variantId = new ThompsonSampling().select(banditArms).variantId;
  } finally {
    Math.random = original;
  }

  const arms = items.map((item) => {
    const { alpha, beta } = statsFor(item);
    const n = alpha + beta;
    return {
      item,
      estimate: alpha / n,
      uncertainty: 1.96 * Math.sqrt((alpha * beta) / (n * n * (n + 1))),
    };
  });
  const chosen = items.find((i) => i.externalRef === variantId);
  if (!chosen) throw new Error(`Thompson picked unknown arm ${variantId}`);
  return { chosen, arms };
}

export function stepActivate(
  source: DemoSource,
  channel: "content_card" | "push",
  chosenRef?: string,
): { mode: "inline" | "reference"; endpoint: string; body: Record<string, unknown>; liquid: string | null } {
  const item = chosenRef
    ? stepContent(source).items.find((i) => i.externalRef === chosenRef)
    : stepDecide(source, DEFAULT_SEED).chosen;
  if (!item) throw new Error(`Unknown content item ${chosenRef} for source ${source}`);
  const mode = source === "braze-catalog" && channel === "content_card" ? "reference" : "inline";
  const liquid = mode === "reference" ? brazeCatalogLiquid("lumen_tips") : null;

  if (channel === "content_card") {
    return {
      mode,
      endpoint: "/campaigns/trigger/send",
      body: {
        campaign_id: "<campaign-uuid>",
        trigger_properties: buildActivationProperties(
          {
            contentSource: source,
            externalRef: item.externalRef,
            title: item.title ?? null,
            body: item.body,
            cta: item.cta ?? null,
            link: item.deeplink ?? null,
          },
          mode,
        ),
        recipients: [{ external_user_id: LUMEN_USER.externalId }],
      },
      liquid,
    };
  }
  return {
    mode,
    endpoint: "/messages/send",
    body: {
      external_user_ids: [LUMEN_USER.externalId],
      messages: {
        apple_push: {
          app_id: "<ios-app-id>",
          alert: { title: item.title ?? "Lumen", body: item.body },
          ...(item.deeplink ? { custom_uri: item.deeplink } : {}),
        },
      },
    },
    liquid,
  };
}

export function stepLearn(stats: ArmStats, converted: boolean): ArmStats {
  return converted ? { alpha: stats.alpha + 1, beta: stats.beta } : { alpha: stats.alpha, beta: stats.beta + 1 };
}

export function stepDecideCaption(personaLabel: string): string {
  return `Arm stats shown are for users like this one (persona: ${personaLabel}).`;
}
