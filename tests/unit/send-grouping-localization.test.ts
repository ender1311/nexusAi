import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant } from "@/lib/cron/send-grouping";
import type { VariantMeta } from "@/lib/cron/send-grouping";
import type { LocalizedCopy } from "@/lib/push-locale";

const meta: VariantMeta = { channel: "push", body: "EN body", title: "EN title", deeplink: null, brazeCampaignId: "c1", brazeVariantId: "bv1" };
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

  it("enabled: separate groups per resolved language with localized copy", () => {
    const groups = groupDecisionsByVariant(
      [user("a", "es"), user("b", "es_ES"), user("c", "zh_TW"), user("d", "en"), user("e", "fr")],
      variantMeta, decisionMap(["a", "b", "c", "d", "e"]),
      { enabled: true, translationsByVariant },
    );
    const list = Object.values(groups);
    const es = list.find((g) => g.body === "ES body")!;
    const zh = list.find((g) => g.body === "ZH body")!;
    const en = list.find((g) => g.body === "EN body")!;
    expect(es.externalUserIds.sort()).toEqual(["a", "b"]); // es + es_ES merge
    expect(es.title).toBe("ES title");
    expect(zh.externalUserIds).toEqual(["c"]);
    expect(en.externalUserIds.sort()).toEqual(["d", "e"]); // en + fr-fallback merge
  });
});
