import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import type { LocalizedCopy } from "@/lib/push-locale";

const meta: VariantMeta = { channel: "push", body: "EN body", title: "EN title", deeplink: null, brazeCampaignId: "c1", brazeVariantId: "bv1", givingHandleStrategy: null, cta: null, iconImageUrl: null };
const variantMeta = new Map<string, VariantMeta>([["v1", meta]]);
const when = new Date("2026-06-01T08:00:00.000Z");

function user(externalId: string, lang: string | undefined) {
  return { user: { externalId, brazeId: null, attributes: lang ? { language_tag: lang } : {} }, variantId: "v1", scheduledAt: when, inLocalTime: false };
}
function decisionMap(ids: string[]) { return new Map(ids.map((id) => [id, `dec-${id}`])); }

const translationsByVariant = new Map<string, Map<string, LocalizedCopy>>([
  ["v1", new Map<string, LocalizedCopy>([
    ["es", { title: "ES title", body: "ES body" }],
    ["zh_TW", { title: "ZH title", body: "ZH body" }],
  ])],
]);

describe("groupDecisionsByVariant localization", () => {
  it("disabled: single English group, body/title untouched", () => {
    const groups = groupDecisionsByVariant(
      [user("a", "es"), user("b", "en")], variantMeta, decisionMap(["a", "b"]),
    );
    const list = Object.values(groups);
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("EN body");
    expect(list[0].title).toBe("EN title");
    expect(list[0].externalUserIds.sort()).toEqual(["a", "b"]);
  });

  it("enabled: localized groups, English-only for en recipients, missing langs skipped", () => {
    const groups = groupDecisionsByVariant(
      [user("a", "es"), user("b", "es_ES"), user("c", "zh_TW"), user("d", "en"), user("e", "fr"), user("f", undefined)],
      variantMeta, decisionMap(["a", "b", "c", "d", "e", "f"]),
      { enabled: true, translationsByVariant },
    );
    const list = Object.values(groups);
    const es = list.find((g) => g.body === "ES body")!;
    const zh = list.find((g) => g.body === "ZH body")!;
    const en = list.find((g) => g.body === "EN body")!;
    expect(es.externalUserIds.sort()).toEqual(["a", "b"]); // es + es_ES merge
    expect(es.title).toBe("ES title");
    expect(zh.externalUserIds).toEqual(["c"]);
    expect(en.externalUserIds).toEqual(["d"]); // only the en recipient; fr + unknown skipped
    // fr ("e") and unknown-language ("f") are dropped entirely.
    const allSent = list.flatMap((g) => g.externalUserIds).sort();
    expect(allSent).toEqual(["a", "b", "c", "d"]);
  });
});

const baseMeta = (channel: string): VariantMeta => ({
  channel, body: "Hello", title: "Hi", cta: null, deeplink: null,
  brazeCampaignId: null, brazeVariantId: null, givingHandleStrategy: null, iconImageUrl: null,
});
const user2 = (lang: string) => ({ externalId: `u-${lang}`, brazeId: null, attributes: { language_tag: lang } });

describe("send-grouping localization is channel-agnostic", () => {
  for (const channel of ["email", "content-card", "in-app", "modal-iam"]) {
    it(`localizes ${channel} copy for a non-English user with a translation`, () => {
      const meta2 = new Map([["v1", baseMeta(channel)]]);
      const decisionIds = new Map([["u-es", "d1"]]);
      const translations = new Map([["v1", new Map([["es", { title: "Hola", body: "Hola mundo" }]])]]);
      const groups = groupDecisionsByVariant(
        [{ user: user2("es"), variantId: "v1", scheduledAt: new Date("2026-06-20T12:00:00Z"), inLocalTime: false }],
        meta2, decisionIds,
        { enabled: true, translationsByVariant: translations },
      );
      const g = Object.values(groups)[0];
      expect(g.body).toBe("Hola mundo");
      expect(g.title).toBe("Hola");
    });

    it(`strict-skips ${channel} for a non-English user with NO translation`, () => {
      const meta2 = new Map([["v1", baseMeta(channel)]]);
      const decisionIds = new Map([["u-es", "d1"]]);
      const groups = groupDecisionsByVariant(
        [{ user: user2("es"), variantId: "v1", scheduledAt: new Date("2026-06-20T12:00:00Z"), inLocalTime: false }],
        meta2, decisionIds,
        { enabled: true, translationsByVariant: new Map([["v1", new Map()]]) },
      );
      expect(Object.keys(groups)).toHaveLength(0);
    });
  }
});
