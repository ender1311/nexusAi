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

export const USD_AMOUNT_LADDER = [5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 200, 250, 500, 1000];

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

/**
 * Compute a personalized ask amount in USD based on user gift history.
 * Anchor blend formula: 0.6 * avg + 0.3 * recent + 0.1 * max (when all three present).
 * Upsell: anchor * 1.1; lapsed discount: * 0.75.
 */
export function selectGiftAmountUSD(attrs: Record<string, unknown>): number {
  const avg = extractPositiveNumber(attrs, "gift_amount_average");
  const recent = extractPositiveNumber(attrs, "gift_amount_most_recent");
  const max = extractPositiveNumber(attrs, "gift_amount_maximum");
  const lifetimeCount = extractPositiveNumber(attrs, "gift_count_lifetime");
  const recentCount = extractPositiveNumber(attrs, "gift_count_past_3_to_36_months");

  // First-time givers: no gift history at all
  if (lifetimeCount === null) {
    return snapToLadder(10, USD_AMOUNT_LADDER);
  }

  // lifetimeCount present but recentCount absent → lapsed giver
  const isLapsed = recentCount === null;

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
    anchor = 10;
  }

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
  const snapped = snapToLadder(Math.max(amount, USD_AMOUNT_LADDER[0]), USD_AMOUNT_LADDER);
  return snapped;
}

/**
 * Build a personalized giving deeplink for the given user attributes.
 * Currency is detected from gift_currency_most_recent (defaults to USD).
 */
export function buildGivingDeeplink(attrs: Record<string, unknown>): string {
  const rawCurrency = attrs["gift_currency_most_recent"];
  const currencyCode =
    typeof rawCurrency === "string" && rawCurrency.trim().length > 0
      ? rawCurrency.trim().toUpperCase()
      : "USD";

  // Resolve to a known currency or fall back to USD
  const resolvedCurrency = CURRENCY_RATES[currencyCode] !== undefined ? currencyCode : "USD";

  // Compute USD ask amount, then convert to local currency if needed
  const usdAmount = selectGiftAmountUSD(attrs);
  let amount: number;

  if (resolvedCurrency === "USD") {
    amount = usdAmount;
  } else {
    // Convert USD amount to local currency ladder
    const localLadder = buildCurrencyLadder(resolvedCurrency);
    // localUsdEquivalent: usdAmount converted to local units for ladder snap
    const rate = CURRENCY_RATES[resolvedCurrency];
    const localRaw = usdAmount * rate;
    amount = snapToLadder(localRaw, localLadder);
  }

  const params = new URLSearchParams({
    currency: resolvedCurrency.toLowerCase(),
    fund: "YouVersion",
    frequency: "monthly",
    amount: String(amount),
    utm_medium: "push",
    utm_source: "Nexus",
    utm_campaign: "optimize_handle",
  });

  return `https://www.bible.com/give?${params.toString()}`;
}
