import { describe, expect, it } from "bun:test";
import {
  snapToLadder,
  buildCurrencyLadder,
  selectGiftAmountUSD,
  selectGiftAmountUSDByStrategy,
  resolveLocalGiftAmount,
  formatGiftAmount,
  isGivingHandleStrategy,
  buildGivingDeeplink,
  USD_AMOUNT_LADDER,
  CURRENCY_RATES,
  usdAmount,
} from "@/lib/engine/giving-link";

describe("snapToLadder", () => {
  it("snaps up to the nearest value >= amount", () => {
    expect(snapToLadder(7, [5, 10, 15, 20])).toBe(10);
  });

  it("exact match returns the same value", () => {
    expect(snapToLadder(10, [5, 10, 15, 20])).toBe(10);
  });

  it("amount > max returns max", () => {
    expect(snapToLadder(1001, [5, 10, 1000])).toBe(1000);
  });

  it("amount < min returns the first (smallest) value", () => {
    expect(snapToLadder(1, [5, 10, 15])).toBe(5);
  });

  it("snaps correctly against the full USD ladder", () => {
    expect(snapToLadder(26, USD_AMOUNT_LADDER)).toBe(30);
    expect(snapToLadder(999, USD_AMOUNT_LADDER)).toBe(1000);
    expect(snapToLadder(5, USD_AMOUNT_LADDER)).toBe(5);
  });
});

describe("buildCurrencyLadder", () => {
  it("USD ladder returns values matching USD_AMOUNT_LADDER (identity rate = 1.0)", () => {
    const ladder = buildCurrencyLadder("USD");
    // USD rate is 1.0 → values map to USD_AMOUNT_LADDER rounded to nice steps
    expect(ladder[0]).toBeGreaterThanOrEqual(5);
    expect(ladder).toContain(10);
    expect(ladder).toContain(100);
  });

  it("unknown currency defaults to rate 1.0 (USD-equivalent ladder)", () => {
    const usdLadder = buildCurrencyLadder("USD");
    const unknownLadder = buildCurrencyLadder("XYZ");
    expect(unknownLadder).toEqual(usdLadder);
  });

  it("EUR produces values scaled by ~0.858 and rounded to nice values", () => {
    const eurLadder = buildCurrencyLadder("EUR");
    const rate = CURRENCY_RATES["EUR"]; // 0.858
    // $100 USD → ~85.8 EUR → snapped to nearest 5 (< 100) = 85
    const expected100 = Math.round(100 * rate / 5) * 5;
    expect(eurLadder).toContain(expected100);
    // All values should be positive
    for (const v of eurLadder) expect(v).toBeGreaterThan(0);
  });

  it("no duplicate values in output", () => {
    for (const currency of ["USD", "EUR", "JPY", "KRW", "IDR", "VND"]) {
      const ladder = buildCurrencyLadder(currency);
      const unique = new Set(ladder);
      expect(unique.size).toBe(ladder.length);
    }
  });

  it("JPY produces large rounded values (high rate ~159)", () => {
    const jpyLadder = buildCurrencyLadder("JPY");
    // $5 USD → ~796 JPY → rounded to nearest 100 = 800
    expect(jpyLadder[0]).toBeGreaterThanOrEqual(500);
    expect(jpyLadder.length).toBeGreaterThan(0);
  });
});

describe("selectGiftAmountUSD", () => {
  it("first-time giver (lifetimeCount absent) returns 10", () => {
    expect(selectGiftAmountUSD({})).toBe(10);
  });

  it("first-time giver (lifetimeCount=0 treated as absent/falsy) returns 10", () => {
    // 0 is treated as absent (non-positive)
    expect(selectGiftAmountUSD({ gift_count_lifetime: 0 })).toBe(10);
  });

  it("lapsed giver gets a lower amount than active giver with same history", () => {
    const shared = {
      gift_count_lifetime: 5,
      gift_amount_average: 50,
      gift_amount_most_recent: 50,
      gift_amount_maximum: 100,
    };
    const activeAmount = selectGiftAmountUSD({
      ...shared,
      gift_count_past_3_to_36_months: 3,
    });
    const lapsedAmount = selectGiftAmountUSD({
      ...shared,
      // no gift_count_past_3_to_36_months → lapsed
    });
    expect(lapsedAmount).toBeLessThan(activeAmount);
  });

  it("full blend: avg=100, recent=80, max=200 → snaps to 150", () => {
    // anchor = 0.6*100 + 0.3*80 + 0.1*200 = 60 + 24 + 20 = 104
    // amount = 104 * 1.1 = 114.4
    // snapToLadder(114.4, USD_AMOUNT_LADDER) = 150 (next rung after 100)
    const result = selectGiftAmountUSD({
      gift_count_lifetime: 5,
      gift_count_past_3_to_36_months: 3,
      gift_amount_average: 100,
      gift_amount_most_recent: 80,
      gift_amount_maximum: 200,
    });
    expect(result).toBe(150);
  });

  it("cap at 1.5× max: non-round max (max=25) stays within cap", () => {
    // cap = 1.5 * 25 = 37.5 — must snap DOWN to 30, not UP to 50
    const result = selectGiftAmountUSD({
      gift_amount_average: 1000,
      gift_amount_most_recent: 1000,
      gift_amount_maximum: 25,
      gift_count_lifetime: 5,
      gift_count_past_3_to_36_months: 3,
    });
    expect(result).toBe(30); // largest ladder value ≤ 37.5
  });

  it("cap at 1.5× max: max=20 → cap=30, snaps to 30", () => {
    // avg=1000 would produce huge amount, but capped at 1.5*20=30
    const result = selectGiftAmountUSD({
      gift_count_lifetime: 5,
      gift_count_past_3_to_36_months: 3,
      gift_amount_average: 1000,
      gift_amount_most_recent: 1000,
      gift_amount_maximum: 20,
    });
    expect(result).toBe(30);
  });

  it("only avg present: uses avg as anchor", () => {
    const result = selectGiftAmountUSD({
      gift_count_lifetime: 3,
      gift_count_past_3_to_36_months: 2,
      gift_amount_average: 50,
    });
    // anchor = 50, amount = 50 * 1.1 = 55 → snaps to 75
    expect(result).toBe(75);
  });

  it("only max present: uses max * 0.5 as anchor", () => {
    const result = selectGiftAmountUSD({
      gift_count_lifetime: 3,
      gift_count_past_3_to_36_months: 2,
      gift_amount_maximum: 100,
    });
    // anchor = 100 * 0.5 = 50, amount = 50 * 1.1 = 55 → snaps to 75
    // but cap = 1.5 * 100 = 150, 55 < 150 so no cap applies
    expect(result).toBe(75);
  });

  it("always returns a value on the USD ladder", () => {
    const cases = [
      {},
      { gift_count_lifetime: 0 },
      { gift_count_lifetime: 1, gift_amount_average: 7 },
      { gift_count_lifetime: 10, gift_amount_average: 500, gift_amount_maximum: 200 },
    ];
    for (const attrs of cases) {
      const result = selectGiftAmountUSD(attrs);
      expect(USD_AMOUNT_LADDER).toContain(result);
    }
  });

  it("minimum return value is 5 (smallest ladder rung)", () => {
    const result = selectGiftAmountUSD({
      gift_count_lifetime: 1,
      gift_count_past_3_to_36_months: 1,
      gift_amount_average: 0.01,
    });
    expect(result).toBeGreaterThanOrEqual(5);
  });
});

describe("buildGivingDeeplink", () => {
  it("returns a URL starting with https://www.bible.com/give", () => {
    const url = buildGivingDeeplink({});
    expect(url.startsWith("https://www.bible.com/give")).toBe(true);
  });

  it("USD currency → contains currency=usd, fund=YouVersion, frequency=monthly", () => {
    const url = buildGivingDeeplink({ gift_currency_most_recent: "USD" });
    expect(url).toContain("currency=usd");
    expect(url).toContain("fund=YouVersion");
    expect(url).toContain("frequency=monthly");
  });

  it("EUR currency → contains currency=eur", () => {
    const url = buildGivingDeeplink({
      gift_currency_most_recent: "EUR",
      gift_count_lifetime: 3,
      gift_count_past_3_to_36_months: 2,
      gift_amount_average: 50,
    });
    expect(url).toContain("currency=eur");
  });

  it("contains all required utm params", () => {
    const url = buildGivingDeeplink({});
    expect(url).toContain("utm_medium=push");
    expect(url).toContain("utm_source=Nexus");
    expect(url).toContain("utm_campaign=nexus-giving");
  });

  it("unknown currency falls back to USD", () => {
    const url = buildGivingDeeplink({ gift_currency_most_recent: "XYZ" });
    expect(url).toContain("currency=usd");
  });

  it("missing currency defaults to USD", () => {
    const url = buildGivingDeeplink({});
    expect(url).toContain("currency=usd");
  });

  it("frequency=monthly is present for all currencies (universal recurring)", () => {
    for (const currency of ["USD", "EUR", "JPY", "BRL", "KRW"]) {
      const url = buildGivingDeeplink({ gift_currency_most_recent: currency });
      expect(url).toContain("frequency=monthly");
    }
  });

  it("amount param is a positive integer in the URL", () => {
    const url = buildGivingDeeplink({
      gift_currency_most_recent: "USD",
      gift_count_lifetime: 5,
      gift_count_past_3_to_36_months: 3,
      gift_amount_average: 50,
    });
    const match = url.match(/amount=(\d+)/);
    expect(match).not.toBeNull();
    const amount = parseInt(match![1], 10);
    expect(amount).toBeGreaterThan(0);
  });
});

describe("usdAmount", () => {
  it("returns the amount unchanged for USD", () => {
    expect(usdAmount(50, "USD")).toBe(50);
  });

  it("defaults null/blank/unknown currency to USD (rate 1)", () => {
    expect(usdAmount(50, null)).toBe(50);
    expect(usdAmount(50, "")).toBe(50);
    expect(usdAmount(50, "ZZZ")).toBe(50);
  });

  it("normalizes a known foreign currency to USD using CURRENCY_RATES", () => {
    // GBP rate = 0.744 units per USD → 74.4 GBP / 0.744 = 100 USD
    expect(usdAmount(74.4, "GBP")).toBeCloseTo(100, 2);
  });

  it("is case-insensitive on the currency code", () => {
    expect(usdAmount(74.4, "gbp")).toBeCloseTo(100, 2);
  });

  it("rounds to cents", () => {
    // JPY rate = 159.24 → 1000 JPY / 159.24 = 6.2798... → 6.28
    expect(usdAmount(1000, "JPY")).toBe(6.28);
  });

  it("returns 0 for a non-finite or non-positive amount", () => {
    expect(usdAmount(0, "USD")).toBe(0);
    expect(usdAmount(NaN, "USD")).toBe(0);
    expect(usdAmount(-10, "USD")).toBe(0);
  });
});

describe("isGivingHandleStrategy", () => {
  it("accepts the four known strategies", () => {
    for (const s of ["avg-gift", "recent-gift", "max-gift", "blend"]) {
      expect(isGivingHandleStrategy(s)).toBe(true);
    }
  });
  it("rejects unknown values", () => {
    expect(isGivingHandleStrategy("fixed")).toBe(false);
    expect(isGivingHandleStrategy(null)).toBe(false);
    expect(isGivingHandleStrategy(42)).toBe(false);
  });
});

describe("selectGiftAmountUSDByStrategy", () => {
  const histories = {
    gift_count_lifetime: 8,
    gift_count_past_3_to_36_months: 4,
    gift_amount_average: 40,
    gift_amount_most_recent: 100,
    gift_amount_maximum: 200,
  };

  it("blend equals selectGiftAmountUSD", () => {
    expect(selectGiftAmountUSDByStrategy(histories, "blend")).toBe(selectGiftAmountUSD(histories));
  });

  it("recent-gift differs from avg-gift when histories diverge", () => {
    expect(selectGiftAmountUSDByStrategy(histories, "recent-gift"))
      .not.toBe(selectGiftAmountUSDByStrategy(histories, "avg-gift"));
  });

  it("avg-gift anchors on gift_amount_average (40 * 1.1 → snaps to 50)", () => {
    expect(selectGiftAmountUSDByStrategy(histories, "avg-gift")).toBe(50);
  });

  it("max-gift halves the max anchor (200 * 0.5 * 1.1 = 110 → snaps to 150)", () => {
    expect(selectGiftAmountUSDByStrategy(histories, "max-gift")).toBe(150);
  });

  it("falls back to blend when the strategy anchor attr is absent", () => {
    const noRecent = { gift_count_lifetime: 3, gift_count_past_3_to_36_months: 2, gift_amount_average: 30 };
    expect(selectGiftAmountUSDByStrategy(noRecent, "recent-gift")).toBe(selectGiftAmountUSD(noRecent));
  });
});

describe("resolveLocalGiftAmount", () => {
  it("USD: amountLocal equals amountUsd", () => {
    const r = resolveLocalGiftAmount({ gift_count_lifetime: 5, gift_count_past_3_to_36_months: 3, gift_amount_average: 40 }, "avg-gift");
    expect(r.currencyCode).toBe("USD");
    expect(r.amountLocal).toBe(r.amountUsd);
  });

  it("foreign currency: amountLocal is the converted snapped value", () => {
    const r = resolveLocalGiftAmount(
      { gift_currency_most_recent: "EUR", gift_count_lifetime: 5, gift_count_past_3_to_36_months: 3, gift_amount_average: 40 },
      "avg-gift",
    );
    expect(r.currencyCode).toBe("EUR");
    expect(r.amountLocal).toBeGreaterThan(0);
  });

  it("unknown currency falls back to USD", () => {
    const r = resolveLocalGiftAmount({ gift_currency_most_recent: "XYZ" }, "blend");
    expect(r.currencyCode).toBe("USD");
  });
});

describe("formatGiftAmount", () => {
  it("formats USD with no fraction digits", () => {
    expect(formatGiftAmount(25, "USD")).toBe("$25");
  });
  it("formats EUR", () => {
    expect(formatGiftAmount(20, "EUR")).toBe("€20");
  });
  it("unknown currency falls back to USD formatting", () => {
    expect(formatGiftAmount(25, "XYZ")).toBe("$25");
  });
});

describe("buildGivingDeeplink with strategy", () => {
  it("recent-gift amount can differ from blend when histories diverge", () => {
    const attrs = {
      gift_count_lifetime: 8,
      gift_count_past_3_to_36_months: 4,
      gift_amount_average: 40,
      gift_amount_most_recent: 200,
      gift_amount_maximum: 250,
    };
    const blend = buildGivingDeeplink(attrs);
    const recent = buildGivingDeeplink(attrs, "recent-gift");
    expect(recent).not.toBe(blend);
  });
});
