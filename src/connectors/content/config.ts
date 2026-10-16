import { z } from "zod";
import { prisma } from "@/lib/db";

export const CONTENT_SOURCE_IDS = ["nexus-library", "contentful", "sanity", "generic-json", "braze-catalog"] as const;
export type ContentSourceId = (typeof CONTENT_SOURCE_IDS)[number];
const CHANNELS = ["push", "email", "content_card", "slideup", "modal"] as const;

const CREDENTIAL_PARAMS = new Set(["token", "key", "secret", "api_key", "apikey"]);
/** Secrets live in env vars, never in the stored config: reject userinfo and credential-looking query params. */
function hasNoEmbeddedCredentials(raw: string): boolean {
  const u = new URL(raw);
  if (u.username || u.password) return false;
  return ![...u.searchParams.keys()].some((k) => CREDENTIAL_PARAMS.has(k.toLowerCase()));
}

const mappingSchema = z.record(z.string(), z.string().min(1)).default({});

export const contentSourceConfigSchema = z.object({
  enabled: z.array(z.enum(CONTENT_SOURCE_IDS)).min(1),
  contentful: z.object({
    spaceId: z.string().min(1), environment: z.string().min(1).default("master"),
    contentType: z.string().min(1), channel: z.enum(CHANNELS), mapping: mappingSchema,
  }).optional(),
  sanity: z.object({
    projectId: z.string().regex(/^[a-z0-9]+$/), dataset: z.string().regex(/^[a-z0-9_-]+$/).default("production"),
    query: z.string().min(1), channel: z.enum(CHANNELS), mapping: mappingSchema,
  }).optional(),
  genericJson: z.object({
    url: z.string().url().refine((u) => u.startsWith("https://"), "url must be https").refine(hasNoEmbeddedCredentials, "url must not contain credentials"), itemsPath: z.string().min(1), channel: z.enum(CHANNELS),
    pagination: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("cursor"), nextPath: z.string().min(1), param: z.string().min(1) }),
      z.object({ mode: z.literal("page"), param: z.string().min(1), pageSize: z.number().int().positive() }),
    ]).default({ mode: "none" }),
    mapping: mappingSchema,
  }).optional(),
  brazeCatalog: z.object({
    catalogName: z.string().regex(/^[a-zA-Z0-9_-]+$/), channel: z.enum(CHANNELS), mapping: mappingSchema,
  }).optional(),
});
export type ContentSourceConfig = z.infer<typeof contentSourceConfigSchema>;

const KEY = "content_source_config";
const DEFAULT: ContentSourceConfig = { enabled: ["nexus-library"] };

/** Single read path for content-source config. P1 replaces the body with a per-workspace Connection lookup. */
export async function getContentSourceConfig(): Promise<ContentSourceConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT;
  try {
    const parsed = contentSourceConfigSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export async function saveContentSourceConfig(c: ContentSourceConfig): Promise<void> {
  const value = JSON.stringify(contentSourceConfigSchema.parse(c));
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}
