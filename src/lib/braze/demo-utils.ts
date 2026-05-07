/**
 * Braze Liquid prefix for demo/test push sends.
 * Renders as "[TEST] Dan, Some Title" in the push notification.
 * This prefix is ONLY for demo sends — live cron sends pass titles verbatim from the DB.
 */
export const DEMO_TITLE_PREFIX = "[TEST] {{${first_name}}}, ";

/**
 * Prepends the demo [TEST] + Liquid first_name prefix to a variant title.
 * Used exclusively by the demo send route — never by the live cron pipeline.
 */
export function buildDemoTitle(variantTitle: string | null): string {
  const baseTitle = variantTitle?.trim() || "";
  return `${DEMO_TITLE_PREFIX}${baseTitle}`;
}
