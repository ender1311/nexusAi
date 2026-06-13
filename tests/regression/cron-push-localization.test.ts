// Regression: push localization send-path. Guards two invariants:
//  1. localizePush=false -> behavior unchanged (single EN group, EN copy).
//  2. localizePush=true  -> per-language groups; NO English fallback. Recipients
//     whose language has no translation (and non-English) are skipped entirely,
//     as are recipients with an unknown/blank language. English recipients still
//     receive the English copy.
// See docs/superpowers/specs/2026-05-30-push-localization-design.md
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import type { LocalizedCopy } from "@/lib/push-locale";

const meta: VariantMeta = { channel: "push", body: "EN", title: "ENt", deeplink: null, brazeCampaignId: "c", brazeVariantId: "b", givingHandleStrategy: null, cta: null, iconImageUrl: null };
const vm = new Map([["v1", meta]]);
const when = new Date("2026-06-01T08:00:00.000Z");
const u = (id: string, lang?: string) => ({ user: { externalId: id, brazeId: null, attributes: lang ? { language_tag: lang } : {} }, variantId: "v1", scheduledAt: when, inLocalTime: false });
const dm = (ids: string[]) => new Map(ids.map((i) => [i, `d-${i}`]));
const tx = new Map<string, Map<string, LocalizedCopy>>([["v1", new Map([["pt", { title: "PTt", body: "PT" }]])]]);

describe("cron push localization regression", () => {
  it("localizePush=false keeps EN-only single group", () => {
    const g = Object.values(groupDecisionsByVariant([u("a", "pt"), u("b")], vm, dm(["a", "b"])));
    expect(g).toHaveLength(1);
    expect(g[0].body).toBe("EN");
    expect(g[0].externalUserIds.sort()).toEqual(["a", "b"]);
  });

  it("localizePush=true localizes pt, sends EN to en recipients, skips missing/unknown langs", () => {
    const g = Object.values(groupDecisionsByVariant(
      [u("a", "pt"), u("b", "de"), u("c"), u("d", "en")], vm, dm(["a", "b", "c", "d"]),
      { enabled: true, translationsByVariant: tx },
    ));
    const pt = g.find((x) => x.body === "PT")!;
    const en = g.find((x) => x.body === "EN");
    expect(pt.externalUserIds).toEqual(["a"]);
    expect(en!.externalUserIds).toEqual(["d"]); // only the en recipient
    // de ("b") has no translation and unknown-language ("c") are both dropped.
    const allSent = g.flatMap((x) => x.externalUserIds).sort();
    expect(allSent).toEqual(["a", "d"]);
  });
});
