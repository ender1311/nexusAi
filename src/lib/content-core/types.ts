import { z } from "zod";

export const CONTENT_CHANNELS = ["push", "email", "content_card", "slideup", "modal"] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

const localeSchema = z.object({ title: z.string().optional(), body: z.string().optional(), subject: z.string().optional() });

export const contentItemSchema = z.object({
  externalRef: z.string().min(1).max(200),
  channel: z.enum(CONTENT_CHANNELS),
  title: z.string().max(500).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(20_000),
  cta: z.string().max(200).optional(),
  deeplink: z.string().max(2000).optional(),
  imageUrl: z.string().url().optional(),
  htmlBody: z.string().max(500_000).optional(),
  tags: z.array(z.string().max(100)).max(50),
  locales: z.record(z.string(), localeSchema).optional(),
  updatedAt: z.string().min(1),
});
export type ContentItem = z.infer<typeof contentItemSchema>;

/** Nexus field → dot path in the source record. `locales` is derived, not mapped. */
export type FieldMapping = Partial<Record<Exclude<keyof ContentItem, "locales" | "channel">, string>>;
