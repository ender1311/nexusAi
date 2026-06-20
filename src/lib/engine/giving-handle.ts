// Shared dynamic-giving-handle resolution. Used by BOTH the cron send path
// (send-grouping) and the demo send route so they can't diverge — a past bug
// shipped raw {{ask}}/{{bibles}} tokens from the demo because only the cron
// resolved them. Pure: no DB / IO.
import {
  GIVING_LINK_SENTINEL,
  DEFAULT_HANDLE_USD,
  resolveLocalGiftAmount,
  formatGiftAmount,
  buildGivingDeeplink,
  isGivingHandleStrategy,
  isGivingFrequency,
  type GivingHandleStrategy,
  type GivingFrequency,
} from "./giving-link";
import { computeBibles, substituteGivingCopy, DEFAULT_DOLLARS_TO_BIBLES } from "./giving-copy";

// A dynamic-handle variant carries its amount strategy in
// actionFeatures.givingHandleStrategy; non-dynamic variants return null.
export function deriveGivingStrategy(subcategory: string | null, actionFeatures: unknown): GivingHandleStrategy | null {
  if (subcategory !== "dynamic-handle") return null;
  const raw = actionFeatures && typeof actionFeatures === "object"
    ? (actionFeatures as Record<string, unknown>)["givingHandleStrategy"]
    : undefined;
  return isGivingHandleStrategy(raw) ? raw : "blend";
}

export function deriveGivingFrequency(actionFeatures: unknown): GivingFrequency {
  const raw = actionFeatures && typeof actionFeatures === "object"
    ? (actionFeatures as Record<string, unknown>)["givingFrequency"]
    : undefined;
  return isGivingFrequency(raw) ? raw : "monthly";
}

export function deriveGivingDefaultUsd(actionFeatures: unknown): number {
  const raw = actionFeatures && typeof actionFeatures === "object"
    ? (actionFeatures as Record<string, unknown>)["givingHandleDefaultUsd"]
    : undefined;
  const n = Number(raw);
  return isFinite(n) && n > 0 ? n : DEFAULT_HANDLE_USD;
}

/** True if any {{token}} remains unsubstituted — guards against shipping a push
 *  with a blank/broken handle (Braze renders unknown {{...}} as empty). */
export function hasUnsubstitutedTokens(...parts: (string | null | undefined)[]): boolean {
  return parts.some((p) => typeof p === "string" && /\{\{/.test(p));
}

export type ResolvedGiving = { title: string | null; body: string; deeplink: string };

/**
 * Resolve a dynamic-handle variant for one user: substitute {{ask}}/{{bibles}}
 * and pick the deeplink (an explicit deeplink wins, e.g. a "find out more" link
 * to the Sowers page; otherwise build the personalized give URL).
 *
 * `locale` — optional BCP 47 tag from the user's `attributes.language_tag`.
 * When supplied, {{bibles}} is formatted with the recipient's locale thousands
 * separator; when absent it falls back to "en-US".
 */
export function resolveGivingHandle(params: {
  title: string | null;
  body: string;
  /** agent override ?? variant deeplink (may be null or the giving sentinel). */
  explicitDeeplink: string | null;
  strategy: GivingHandleStrategy;
  frequency: GivingFrequency;
  defaultUsd: number;
  attrs: Record<string, unknown>;
  multiplier: number;
  /** BCP 47 locale tag for number formatting (e.g. "de", "es_MX"). */
  locale?: string | null;
}): ResolvedGiving {
  const { amountLocal, currencyCode } = resolveLocalGiftAmount(params.attrs, params.strategy, params.defaultUsd);
  const amountDisplay = formatGiftAmount(amountLocal, currencyCode);
  const bibles = computeBibles(amountLocal, params.multiplier || DEFAULT_DOLLARS_TO_BIBLES);
  const locale = params.locale ?? (typeof params.attrs.language_tag === "string" ? params.attrs.language_tag : null);
  return {
    title: params.title != null ? substituteGivingCopy(params.title, { amountDisplay, bibles }, locale) : null,
    body: substituteGivingCopy(params.body, { amountDisplay, bibles }, locale),
    deeplink: params.explicitDeeplink && params.explicitDeeplink !== GIVING_LINK_SENTINEL
      ? params.explicitDeeplink
      : buildGivingDeeplink(params.attrs, params.strategy, params.frequency, params.defaultUsd),
  };
}
