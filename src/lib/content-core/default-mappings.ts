import type { FieldMapping } from "./types";

export const DEFAULT_MAPPINGS: Record<"contentful" | "sanity" | "generic-json" | "braze-catalog", FieldMapping> = {
  contentful: {
    externalRef: "sys.id", updatedAt: "sys.updatedAt", title: "fields.title", body: "fields.body",
    subject: "fields.subject", cta: "fields.cta", deeplink: "fields.deeplink",
    imageUrl: "fields.imageUrl", tags: "metadata.tags[*].sys.id",
  },
  sanity: {
    externalRef: "_id", updatedAt: "_updatedAt", title: "title", body: "body", subject: "subject",
    cta: "cta", deeplink: "deeplink", imageUrl: "imageUrl", tags: "tags",
  },
  "generic-json": { externalRef: "id", updatedAt: "updatedAt", title: "title", body: "body", cta: "cta", deeplink: "deeplink", imageUrl: "imageUrl", tags: "tags" },
  "braze-catalog": { externalRef: "id", title: "title", body: "body", cta: "cta", deeplink: "deeplink", imageUrl: "image_url", tags: "tags" },
};
