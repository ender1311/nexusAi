/**
 * Push send-eligibility gate based on a user's behavioral preferred external channel.
 *
 * Pure module (no DB/IO). Decides whether a push agent may target a given user,
 * respecting the user's preferred-channel signal synced from Hightouch.
 *
 * Data contract (see docs/preferred-channel-sync-fix.md):
 *   attributes.preferred_channel_external_30_days  — active-stage primary window
 *   attributes.preferred_channel_external_90_days  — inactive-stage primary window
 *   attributes.preferred_channel_overall_30_days   — permissive cascade tier
 *   attributes.preferred_channel_overall_90_days   — permissive cascade tier
 * Value vocabulary: push_notification | email | in_app_message | content_card.
 * No signal in a window → key absent or empty string (treated as null/no-signal).
 */

export type PushTargetingMode = "strict" | "permissive" | "broad";

export const PUSH_TARGETING_MODES = ["strict", "permissive", "broad"] as const;

export const DEFAULT_PUSH_TARGETING_MODE: PushTargetingMode = "permissive";

export function isPushTargetingMode(value: unknown): value is PushTargetingMode {
  return (
    typeof value === "string" &&
    (PUSH_TARGETING_MODES as readonly string[]).includes(value)
  );
}

type ChannelStats = Record<string, { sent: number; converted: number }>;

/**
 * Normalizes a raw channel value to a canonical token.
 * Non-string or empty/whitespace → null (no signal).
 * push / push_notification → "push"; other recognized values pass through lowercased.
 */
function normalizeChannel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return null;
  if (trimmed === "push" || trimmed === "push_notification") return "push";
  return trimmed;
}

function isNewStage(funnelStage: string | null | undefined): boolean {
  return funnelStage === "new" || funnelStage === "new_user";
}

/** Active stages read the fresh 30-day window; everyone else reads the 90-day window. */
function primaryExternalKey(funnelStage: string | null | undefined): string {
  if (funnelStage === "dau4" || funnelStage === "wau") {
    return "preferred_channel_external_30_days";
  }
  return "preferred_channel_external_90_days";
}

function otherExternalKey(primaryKey: string): string {
  return primaryKey === "preferred_channel_external_30_days"
    ? "preferred_channel_external_90_days"
    : "preferred_channel_external_30_days";
}

/**
 * Behavioral fallback when no preferred-channel attribute carries a signal.
 * Eligible iff push conversions ≥ email conversions; ties broken by send count
 * favoring push. No stats → eligible (preserve reach for users with no history).
 */
function channelStatsFavorsPush(channelStats: unknown): boolean {
  const stats = (channelStats as ChannelStats) ?? {};
  const push = stats["push"];
  const email = stats["email"];
  if (!push && !email) return true;
  const pushConv = push?.converted ?? 0;
  const emailConv = email?.converted ?? 0;
  if (pushConv !== emailConv) return pushConv > emailConv;
  return (push?.sent ?? 0) >= (email?.sent ?? 0);
}

/**
 * Whether a push agent may target this user under the given targeting mode.
 *
 * - broad: always eligible (preferred-channel gate disabled).
 * - new / new_user stage: always eligible (no preferred-channel gate; targeted broadly).
 * - strict: only the stage-primary external window decides. push → eligible;
 *   any non-push value OR no signal → excluded (no fallback).
 * - permissive: cascade through [primary external, other external, overall 30d,
 *   overall 90d]. The first tier with a signal decides (push → eligible, else
 *   excluded). If every tier is empty, fall back to channelStats engagement.
 *
 * The opt-out gate (newsletter_push_enabled !== false) is applied by the caller
 * before this function — it is not re-checked here.
 */
export function isPushPreferred(
  attributes: Record<string, unknown>,
  channelStats: unknown,
  funnelStage: string | null | undefined,
  mode: PushTargetingMode
): boolean {
  if (mode === "broad") return true;
  if (isNewStage(funnelStage)) return true;

  const primaryKey = primaryExternalKey(funnelStage);

  if (mode === "strict") {
    return normalizeChannel(attributes[primaryKey]) === "push";
  }

  // permissive cascade
  const tiers = [
    primaryKey,
    otherExternalKey(primaryKey),
    "preferred_channel_overall_30_days",
    "preferred_channel_overall_90_days",
  ];
  for (const key of tiers) {
    const signal = normalizeChannel(attributes[key]);
    if (signal !== null) return signal === "push";
  }

  return channelStatsFavorsPush(channelStats);
}
