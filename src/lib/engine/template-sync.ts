/**
 * Fields that sync from template to clones. All other fields are clone-owned.
 * - status: pausing/retiring a library variant propagates to all agent clones
 * - subcategory/iconImageUrl: content metadata that belongs to the template
 */
export const TEMPLATE_COPY_FIELDS = [
  "title", "body", "deeplink", "cta", "category", "subcategory", "iconImageUrl", "status", "actionFeatures",
] as const;
