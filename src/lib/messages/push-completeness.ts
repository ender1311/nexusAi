/**
 * Push completeness rules.
 *
 * A push notification must carry both a non-empty title AND a non-empty body
 * to be sendable. Other channels (email, in-app) have no title requirement, so
 * callers apply these checks only to push-channel variants.
 *
 * Pure module — no DB or IO. Used by API validation, the send cron's candidate
 * filtering, and the Push Library "Incomplete" UI flag, so the rule lives in
 * exactly one place.
 */

export type PushCompletenessInput = {
  title?: string | null;
  body?: string | null;
};

const PUSH_REQUIRED_FIELDS = ["title", "body"] as const;
export type PushField = (typeof PUSH_REQUIRED_FIELDS)[number];

function isPresent(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Required push fields that are missing or blank. Empty array means complete. */
export function missingPushFields(variant: PushCompletenessInput): PushField[] {
  return PUSH_REQUIRED_FIELDS.filter((field) => !isPresent(variant[field]));
}

/** A push variant is complete only when it has both a non-empty title and body. */
export function isPushVariantComplete(variant: PushCompletenessInput): boolean {
  return missingPushFields(variant).length === 0;
}
