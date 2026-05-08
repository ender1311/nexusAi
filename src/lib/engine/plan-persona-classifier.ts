/**
 * plan-persona-classifier.ts
 *
 * Maps Braze custom attributes → Persona labels using:
 *  1. PlanSetMember lookup  (plan_day_last_plan_id → persona tag)
 *  2. Publisher match       (plan_day_last_plan_publisher = "Life.Church" → Church-first)
 *  3. Behavioral heuristics (lifetime counts, recency gaps → Returning / Seeker)
 *
 * Pure function — no DB calls. Caller passes in the resolved set memberships.
 */

export interface BrazeAttributes {
  plan_day_last_plan_id?: string | null;
  plan_day_last_plan_length?: number | null;
  plan_day_last_plan_publisher?: string | null;
  plan_day_current_year_count?: number | null;
  plan_day_current_month_count?: number | null;
  plan_day_year?: string | null;          // "2026"
  plan_finish_lifetime_count?: number | null;
  gp_current_year_count?: number | null;  // guided prayer
  gs_current_year_count?: number | null;  // guided scripture
  badge_current_year_count?: number | null;
}

/**
 * Given a set of plan-set memberships for a plan ID (persona tags),
 * plus Braze attributes, return the best-matching persona label.
 *
 * Priority order (first match wins):
 *  1. Returning  — was active, now lapsed
 *  2. Family-first — parenting plan membership
 *  3. Searching  — new to faith + low engagement
 *  4. Plugged-in — Life.Church publisher
 *  5. Anxious    — emotional content + high prayer
 *  6. Word-driven — long/whole-Bible plans + low prayer
 *  7. Studious   — deep study content
 *  8. Connected  — young adults content
 *  9. null       — not enough signal
 */
export function classifyPersona(
  attrs: BrazeAttributes,
  planPersonaTags: string[],   // all persona tags for plan_day_last_plan_id
  currentYear = new Date().getFullYear(),
): string | null {
  const yearCount = attrs.plan_day_current_year_count ?? 0;
  const monthCount = attrs.plan_day_current_month_count ?? 0;
  const lifetimeFinishes = attrs.plan_finish_lifetime_count ?? 0;
  const prayerYear = attrs.gp_current_year_count ?? 0;
  const scriptureYear = attrs.gs_current_year_count ?? 0;
  const planYear = attrs.plan_day_year ? parseInt(attrs.plan_day_year) : null;
  const planLength = attrs.plan_day_last_plan_length ?? 0;
  const publisher = attrs.plan_day_last_plan_publisher ?? "";

  // 1. Returning — had engagement history but lapsed
  if (lifetimeFinishes >= 2 && yearCount === 0 && (planYear === null || planYear < currentYear)) {
    return "Re-engager";
  }

  // 2. Family-first — in a parenting collection
  if (planPersonaTags.includes("Parent")) {
    return "Parent";
  }

  // 3. Searching — new to faith plan + very low engagement
  if (planPersonaTags.includes("Seeker") && lifetimeFinishes < 2 && yearCount < 15) {
    return "Seeker";
  }

  // 4. Plugged-in — Life.Church publisher
  if (publisher.toLowerCase().includes("life.church")) {
    return "Church-first";
  }

  // 5. Anxious — emotional content + meaningful prayer/scripture usage
  if (planPersonaTags.includes("Emotion-first") && (prayerYear >= 2 || scriptureYear >= 2)) {
    return "Emotion-first";
  }
  if ((prayerYear >= 5 || scriptureYear >= 5) && yearCount < 20) {
    return "Emotion-first";
  }

  // 6. Word-driven — year-long/whole-Bible plans, low prayer, high plan engagement
  if (planPersonaTags.includes("Bible-first") || planLength >= 90) {
    if (prayerYear < 3) return "Bible-first";
  }

  // 7. Studious — deep study content or high devotional frequency
  if (planPersonaTags.includes("Devotion-first") || (yearCount >= 30 && lifetimeFinishes >= 3)) {
    return "Devotion-first";
  }

  // 8. Connected — young adults content or high badge count (social engagement)
  if (planPersonaTags.includes("Social-first") || (attrs.badge_current_year_count ?? 0) >= 5) {
    return "Social-first";
  }

  // 9. Low engagement new user → Searching fallback
  // Require explicit engagement data — if plan_finish_lifetime_count is absent, no signal
  if (attrs.plan_finish_lifetime_count != null && lifetimeFinishes === 0 && yearCount < 5 && monthCount < 3) {
    return "Seeker";
  }

  return null;
}
