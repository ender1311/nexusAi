export const GIVING_LINK_SENTINEL = "{{giving_link}}";

// USD exchange rates: units of foreign currency per 1 USD
export const CURRENCY_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 0.858,
  GBP: 0.744,
  CAD: 1.378,
  AUD: 1.396,
  NZD: 1.686,
  CHF: 0.784,
  JPY: 159.24,
  KRW: 1494.63,
  CNY: 6.778,
  HKD: 7.834,
  SGD: 1.276,
  TWD: 31.40,
  INR: 95.73,
  PHP: 61.36,
  IDR: 15525,
  VND: 25300,
  THB: 32.56,
  MYR: 3.979,
  BRL: 5.031,
  MXN: 17.32,
  ARS: 1409.43,
  COP: 3641.90,
  CLP: 890.74,
  PEN: 3.68,
  NGN: 1547,
  ZAR: 16.22,
  GHS: 14.2,
  KES: 129,
  EGP: 48.5,
  PKR: 278.58,
  BDT: 119,
  LKR: 328.46,
};

/**
 * Convert a gift amount in `currency` to USD, rounded to cents.
 * Unknown/blank/null currency defaults to USD (rate 1).
 * Non-finite or non-positive amounts return 0.
 * CURRENCY_RATES holds units of foreign currency per 1 USD, so usd = amount / rate.
 */
export function usdAmount(amount: number, currency: string | null): number {
  if (!isFinite(amount) || amount <= 0) return 0;
  const code =
    typeof currency === "string" && currency.trim().length > 0
      ? currency.trim().toUpperCase()
      : "USD";
  const rate = CURRENCY_RATES[code] ?? 1;
  return Math.round((amount / rate) * 100) / 100;
}

export const USD_AMOUNT_LADDER = [5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 200, 250, 500, 1000];

// Default monthly ask (USD) for users with no gift history to anchor on.
export const DEFAULT_HANDLE_USD = 25;
// Bounds for the never-giver default ask. Variants experiment within this range
// (carried per-variant via actionFeatures.givingHandleDefaultUsd); the bandit +
// LinUCB context vector learn the best default per user / look-alike cohort.
export const MIN_HANDLE_USD = 5;
export const MAX_HANDLE_USD = 100;

// Clamp a per-variant default ask to the experiment range; non-finite → DEFAULT.
export function clampHandleDefault(usd: number): number {
  if (!isFinite(usd)) return DEFAULT_HANDLE_USD;
  return Math.min(MAX_HANDLE_USD, Math.max(MIN_HANDLE_USD, usd));
}

/**
 * Snap amount up to the nearest ladder value >= amount.
 * If amount exceeds the largest ladder value, return the largest.
 */
export function snapToLadder(amount: number, ladder: number[]): number {
  for (const step of ladder) {
    if (step >= amount) return step;
  }
  return ladder[ladder.length - 1];
}

// Floor snap — finds largest rung ≤ amount (used for cap enforcement)
function snapDownToLadder(amount: number, ladder: number[]): number {
  let result = ladder[0];
  for (const step of ladder) {
    if (step <= amount) result = step;
    else break;
  }
  return result;
}

/**
 * Round a value to a "nice" step size based on its magnitude.
 * Rounding formula: Math.round(value / step) * step
 */
function snapToNiceValue(value: number): number {
  let step: number;
  if (value < 10) step = 1;
  else if (value < 100) step = 5;
  else if (value < 1000) step = 10;
  else if (value < 10000) step = 100;
  else step = 1000;
  return Math.round(value / step) * step;
}

/**
 * Convert the USD ladder to the target currency and round each value to a nice step.
 * Conversion formula: localAmount = usdAmount * rate, then snap to nice rounding.
 */
export function buildCurrencyLadder(currencyCode: string): number[] {
  const rate = CURRENCY_RATES[currencyCode] ?? 1.0;

  const rawValues = USD_AMOUNT_LADDER.map((usd) => snapToNiceValue(usd * rate));

  // Adjacent dedup is sufficient because conversion + snapToNiceValue is monotone non-decreasing
  const unique: number[] = [];
  for (const v of rawValues) {
    if (unique[unique.length - 1] !== v) unique.push(v);
  }

  if (unique.length === 0) {
    return [Math.round(5 * rate)];
  }

  return unique;
}

/**
 * Extract a numeric attribute from attrs; returns null for absent/null/NaN/0 values.
 */
function extractPositiveNumber(attrs: Record<string, unknown>, key: string): number | null {
  const raw = attrs[key];
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

export type GivingHandleStrategy = "avg-gift" | "recent-gift" | "max-gift" | "blend";

export function isGivingHandleStrategy(s: unknown): s is GivingHandleStrategy {
  return s === "avg-gift" || s === "recent-gift" || s === "max-gift" || s === "blend";
}

// Recurring vs one-time give-page mode. Emitted as the `frequency` URL param.
// NOTE: "once" is the conventional bible.com value for a one-time gift; verify
// against the live give page before relying on it in production (the recurring
// "monthly" value is already proven). Default stays "monthly" everywhere.
export type GivingFrequency = "monthly" | "once";

export function isGivingFrequency(s: unknown): s is GivingFrequency {
  return s === "monthly" || s === "once";
}

// Shared post-anchor ask pipeline: upsell ×1.1, lapsed ×0.75, cap at 1.5×max, snap to ladder.
function applyAskPipeline(anchor: number, attrs: Record<string, unknown>): number {
  const max = extractPositiveNumber(attrs, "gift_amount_maximum");
  const lifetimeCount = extractPositiveNumber(attrs, "gift_count_lifetime");
  const recentCount = extractPositiveNumber(attrs, "gift_count_past_3_to_36_months");

  // lifetimeCount present but recentCount absent → lapsed giver
  const isLapsed = lifetimeCount !== null && recentCount === null;

  // Apply 10% upsell
  let amount = anchor * 1.1;

  // Lapsed giver discount: reduce ask by 25% to re-engage
  if (isLapsed) {
    amount = amount * 0.75;
  }

  // Cap at 1.5× historical max before snapping
  if (max !== null) {
    const cap = max * 1.5;
    if (amount > cap) {
      // If cap is below the minimum ladder value, return minimum
      if (cap < USD_AMOUNT_LADDER[0]) return USD_AMOUNT_LADDER[0];
      return snapDownToLadder(cap, USD_AMOUNT_LADDER);
    }
  }

  // Snap to ladder, ensuring minimum of 5
  return snapToLadder(Math.max(amount, USD_AMOUNT_LADDER[0]), USD_AMOUNT_LADDER);
}

/**
 * Compute a personalized ask amount in USD based on user gift history.
 * Anchor blend formula: 0.6 * avg + 0.3 * recent + 0.1 * max (when all three present).
 * Upsell: anchor * 1.1; lapsed discount: * 0.75.
 */
export function selectGiftAmountUSD(
  attrs: Record<string, unknown>,
  defaultUsd: number = DEFAULT_HANDLE_USD,
): number {
  const fallback = clampHandleDefault(defaultUsd);
  const avg = extractPositiveNumber(attrs, "gift_amount_average");
  const recent = extractPositiveNumber(attrs, "gift_amount_most_recent");
  const max = extractPositiveNumber(attrs, "gift_amount_maximum");
  const lifetimeCount = extractPositiveNumber(attrs, "gift_count_lifetime");

  // First-time givers: no gift history at all
  if (lifetimeCount === null) {
    return snapToLadder(fallback, USD_AMOUNT_LADDER);
  }

  // Anchor blend — weighted average of available signals
  let anchor: number;
  if (avg !== null && recent !== null && max !== null) {
    // Full blend: weighted mean of avg, recent, max
    anchor = 0.6 * avg + 0.3 * recent + 0.1 * max;
  } else if (avg !== null) {
    anchor = avg;
  } else if (recent !== null) {
    anchor = recent;
  } else if (max !== null) {
    // Max is a ceiling signal; use 50% to avoid over-asking
    anchor = max * 0.5;
  } else {
    // Giver of record but no amount signal → anchor on the configured default.
    anchor = fallback;
  }

  return applyAskPipeline(anchor, attrs);
}

export function selectGiftAmountUSDByStrategy(
  attrs: Record<string, unknown>,
  strategy: GivingHandleStrategy,
  defaultUsd: number = DEFAULT_HANDLE_USD,
): number {
  if (strategy === "blend") return selectGiftAmountUSD(attrs, defaultUsd);
  const anchorKey =
    strategy === "avg-gift" ? "gift_amount_average"
    : strategy === "recent-gift" ? "gift_amount_most_recent"
    : "gift_amount_maximum";
  const anchor = extractPositiveNumber(attrs, anchorKey);
  if (anchor === null) return selectGiftAmountUSD(attrs, defaultUsd);
  const rawAnchor = strategy === "max-gift" ? anchor * 0.5 : anchor;
  return applyAskPipeline(rawAnchor, attrs);
}

/**
 * Resolve the user's preferred currency from gift_currency_most_recent.
 * Uppercases/trims, defaults to USD, falls back to USD if not in CURRENCY_RATES.
 */
function resolveCurrencyCode(attrs: Record<string, unknown>): string {
  const rawCurrency = attrs["gift_currency_most_recent"];
  const currencyCode =
    typeof rawCurrency === "string" && rawCurrency.trim().length > 0
      ? rawCurrency.trim().toUpperCase()
      : "USD";
  return CURRENCY_RATES[currencyCode] !== undefined ? currencyCode : "USD";
}

export function resolveLocalGiftAmount(
  attrs: Record<string, unknown>,
  strategy: GivingHandleStrategy,
  defaultUsd: number = DEFAULT_HANDLE_USD,
): { amountLocal: number; currencyCode: string; amountUsd: number } {
  const currencyCode = resolveCurrencyCode(attrs);
  const amountUsd = selectGiftAmountUSDByStrategy(attrs, strategy, defaultUsd);
  let amountLocal: number;
  if (currencyCode === "USD") {
    amountLocal = amountUsd;
  } else {
    const localLadder = buildCurrencyLadder(currencyCode);
    const rate = CURRENCY_RATES[currencyCode];
    amountLocal = snapToLadder(amountUsd * rate, localLadder);
  }
  return { amountLocal, currencyCode, amountUsd };
}

export function formatGiftAmount(amountLocal: number, currencyCode: string): string {
  const code = CURRENCY_RATES[currencyCode] !== undefined ? currencyCode : "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(amountLocal);
}

/**
 * Build a personalized giving deeplink for the given user attributes.
 * Currency is detected from gift_currency_most_recent (defaults to USD).
 */
export function buildGivingDeeplink(
  attrs: Record<string, unknown>,
  strategy: GivingHandleStrategy = "blend",
  frequency: GivingFrequency = "monthly",
  defaultUsd: number = DEFAULT_HANDLE_USD,
): string {
  const { amountLocal, currencyCode } = resolveLocalGiftAmount(attrs, strategy, defaultUsd);
  const params = new URLSearchParams({
    currency: currencyCode.toLowerCase(),
    fund: "YouVersion",
    frequency,
    amount: String(amountLocal),
    utm_medium: "push",
    // utm_source/utm_campaign are (re)set per outbound channel by withNexusUtm at
    // payload-build time; the defaults here cover any path that bypasses it.
    utm_source: "push",
    utm_campaign: "nexus",
    // Dynamic giving handle, e.g. a $25 ask → "25handle". Preserved by withNexusUtm.
    utm_content: `${amountLocal}handle`,
  });
  return `https://www.bible.com/give?${params.toString()}`;
}
