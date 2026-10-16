// Sample data for the demo walkthrough: "Lumen", a fictional wellness app.
// Everything here is invented for illustration.
import type { ContentItem, FieldMapping } from "@content-core/types";

export const DEMO_SOURCES = ["contentful", "sanity", "generic-json", "braze-catalog", "nexus-library"] as const;
export type DemoSource = (typeof DEMO_SOURCES)[number];

/** Dimension order of the engine's 10-dim feature vector (see feature-vector.ts). */
export const FEATURE_LABELS: string[] = [
  "Push engagement",
  "Email engagement",
  "Morning activity",
  "Evening activity",
  "Weekend activity",
  "Conversion rate",
  "Recency",
  "Vertical signal A",
  "Vertical signal B (set by the vertical pack)",
  "Engagement frequency",
];

/**
 * A warehouse row in the shape computeFeatureVector reads: channelStats is
 * { sent, converted } per channel, hourlyStats a 24-slot histogram (hour 0-23),
 * dailyStats a 7-slot histogram (index 0 = Sunday, 6 = Saturday).
 */
export const LUMEN_USER = {
  externalId: "lumen-user-1832",
  attributes: { plan: "free", locale: "en", sessions_7d: 5, last_open_hour: 7, days_since_last_open: 2, streak_days: 4 },
  totalDecisions: 18,
  totalConversions: 3,
  totalReward: 3,
  channelStats: { push: { sent: 12, converted: 2 }, email: { sent: 6, converted: 1 } },
  hourlyStats: [0, 0, 0, 0, 0, 0, 0, 6, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0],
  dailyStats: [2, 0, 0, 0, 0, 0, 3],
};

// Centroid order matches FEATURE_LABELS.
export const LUMEN_PERSONAS: { id: string; label: string; centroid: number[] }[] = [
  { id: "morning-routine", label: "Morning routine", centroid: [0.35, 0.15, 0.85, 0.05, 0.2, 0.3, 0.9, 0, 0, 0.6] },
  { id: "evening-wind-down", label: "Evening wind-down", centroid: [0.25, 0.2, 0.05, 0.85, 0.3, 0.25, 0.8, 0, 0, 0.5] },
  { id: "weekend-explorer", label: "Weekend explorer", centroid: [0.15, 0.3, 0.25, 0.2, 0.8, 0.2, 0.6, 0, 0, 0.35] },
  { id: "drifting-away", label: "Drifting away", centroid: [0.05, 0.05, 0.2, 0.2, 0.25, 0.05, 0.1, 0, 0, 0.1] },
];

const contentfulEntry = (
  id: string,
  title: string,
  body: string,
  cta: string,
  deeplink: string,
  tag: string,
  imageUrl: string,
  extraBody: Record<string, string> = {},
) => ({
  sys: { id, updatedAt: "2026-10-01T09:00:00Z" },
  fields: {
    title: { "en-US": title },
    body: { "en-US": body, ...extraBody },
    cta: { "en-US": cta },
    deeplink: { "en-US": deeplink },
    imageUrl: { "en-US": imageUrl },
  },
  metadata: { tags: [{ sys: { id: tag } }] },
});

const sanityDoc = (id: string, title: string, body: string, cta: string, deeplink: string, tag: string) => ({
  _id: id,
  _updatedAt: "2026-10-01T09:00:00Z",
  title,
  body,
  cta,
  deeplink,
  tags: [tag],
});

const nexusItem = (externalRef: string, title: string, body: string, cta: string, deeplink: string, tag: string): ContentItem => ({
  externalRef,
  channel: "push",
  title,
  body,
  cta,
  deeplink,
  tags: [tag],
  updatedAt: "2026-10-01T09:00:00Z",
});

const COPY_ROWS = [
  { key: "breathing", title: "2-minute breathing", body: "Take two minutes to reset. A short guided breath is waiting.", cta: "Start now", deeplink: "lumen://breathe/2min" },
  { key: "sleep", title: "Sleep story", body: "Tonight's story is ready. Wind down and drift off.", cta: "Listen", deeplink: "lumen://sleep/tonight" },
  { key: "streak", title: "Streak nudge", body: "You are on a 4-day streak. One short session keeps it going.", cta: "Keep it going", deeplink: "lumen://streak" },
  { key: "upgrade", title: "Upgrade to Lumen Plus", body: "Unlock the full library of sessions, sleep stories and courses.", cta: "See Plus", deeplink: "lumen://plus" },
] as const;

const IMAGES = [
  "https://images.example.com/lumen/breathing.jpg",
  "https://images.example.com/lumen/sleep.jpg",
  "https://images.example.com/lumen/streak.jpg",
  "https://images.example.com/lumen/plus.jpg",
];

const GENERIC_JSON_MAPPING: FieldMapping = {
  externalRef: "id", title: "headline", body: "text", cta: "button", deeplink: "url", tags: "labels",
};

export const LUMEN_CONTENT: {
  contentful: unknown[];
  sanity: unknown[];
  genericJson: { record: unknown[]; mapping: FieldMapping };
  brazeCatalog: unknown[];
  nexusLibrary: ContentItem[];
} = {
  contentful: COPY_ROWS.map((r, i) =>
    contentfulEntry(
      `lumen-${r.key}`, r.title, r.body, r.cta, r.deeplink, r.key, IMAGES[i]!,
      r.key === "breathing" ? { es: "Tomate dos minutos para reiniciar. Una respiracion guiada te espera." } : {},
    ),
  ),
  sanity: COPY_ROWS.map((r) => sanityDoc(`lumen-${r.key}`, r.title, r.body, r.cta, r.deeplink, r.key)),
  genericJson: {
    record: COPY_ROWS.map((r) => ({ id: `lumen-${r.key}`, headline: r.title, text: r.body, button: r.cta, url: r.deeplink, labels: [r.key] })),
    mapping: GENERIC_JSON_MAPPING,
  },
  brazeCatalog: COPY_ROWS.map((r, i) => ({ id: `tip_${i + 1}`, title: r.title, body: r.body, cta: r.cta, deeplink: r.deeplink, tags: [r.key] })),
  nexusLibrary: COPY_ROWS.map((r) => nexusItem(`lumen-${r.key}`, r.title, r.body, r.cta, r.deeplink, r.key)),
};
