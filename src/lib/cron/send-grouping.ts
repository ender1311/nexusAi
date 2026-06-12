import { randomUUID } from "crypto";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import type { BrazeRecipient } from "@/lib/braze/payload-factory";
import {
  GIVING_LINK_SENTINEL,
  buildGivingDeeplink,
  resolveLocalGiftAmount,
  formatGiftAmount,
  type GivingHandleStrategy,
  type GivingFrequency,
} from "@/lib/engine/giving-link";
import { computeBibles, substituteGivingCopy, DEFAULT_DOLLARS_TO_BIBLES } from "@/lib/engine/giving-copy";
import { resolvePushLocaleStrict, type LocalizedCopy } from "@/lib/push-locale";
import { VERSE_PUSH_SENTINEL, pickVerse, resolveVerseCopy, type VersePool, type VerseStrategy } from "@/lib/verse-content";
import { VERSE_IMAGE_SENTINEL, DEFAULT_VERSE_IMAGE_ID, buildVerseImageUrls } from "@/lib/verse-image";
import { substituteVotdTags, substituteGpTags } from "@/lib/votd/votd-tags";
import { guidedLabels } from "@/lib/votd/labels";
import { resolveVotdUserKey, votdContentKey } from "@/lib/votd/votd-user-key";
import type { VotdContent } from "@/lib/votd/votd-content";
import type { GpContent } from "@/lib/votd/guided-prayer-content";
import { buildGpImageUrls } from "@/lib/votd/guided-prayer-content";

export type VariantSendGroup = {
  variantId: string;
  brazeVariantId: string | null;
  brazeCampaignId: string | null;
  channel: string;
  body: string;
  title: string | null;
  deeplink: string | null;
  iosImageUrl: string | null;
  androidImageUrl: string | null;
  inLocalTime?: boolean;
  scheduledAt?: Date;
  externalUserIds: string[];
  /** Nexus externalIds that are actually Braze user IDs (unverified users).
   *  These are sent via the recipients[] format with braze_id instead of external_user_id. */
  brazeOnlyIds: Set<string>;
  decisionIds: string[];
};

export type VariantMeta = {
  channel: string;
  body: string;
  title: string | null;
  deeplink: string | null;
  brazeCampaignId: string | null;
  brazeVariantId: string | null;
  /** Non-null marks a dynamic-handle variant; selects the per-user ask strategy. */
  givingHandleStrategy: GivingHandleStrategy | null;
  /** One-time vs recurring give-page mode for resolved giving deeplinks. Defaults to "monthly". */
  givingFrequency?: GivingFrequency;
  /** null = no image; VERSE_IMAGE_SENTINEL = per-verse image; https URL = static image. */
  iconImageUrl: string | null;
};

type GroupUser = {
  externalId: string;
  brazeId: string | null;
  attributes: unknown;
};

/**
 * Pure: group per-user decisions into per-variant send batches, keyed by
 * variant + scheduled time + local-time flag + resolved deeplink so that users
 * sharing a payload are sent together. Resolves the giving-link sentinel to a
 * per-user URL. No DB / network access.
 */
export function groupDecisionsByVariant(
  inputs: Array<{ user: GroupUser; variantId: string; scheduledAt: Date; inLocalTime: boolean }>,
  variantMeta: Map<string, VariantMeta>,
  decisionIdByUser: Map<string, string>,
  localization?: {
    enabled: boolean;
    translationsByVariant: Map<string, Map<string, LocalizedCopy>>;
    versePool?: VersePool;
    strategyByVariant?: Map<string, VerseStrategy>;
    /** Push variants whose title/body contain {{votd_*}} liquid tags. */
    votdVariantIds?: Set<string>;
    /** Pre-fetched VOTD rows keyed by votdContentKey(date, languageTag). */
    votdContent?: Map<string, VotdContent>;
    /** Push variants whose title/body contain {{gp_*}} liquid tags. */
    gpVariantIds?: Set<string>;
    /** Pre-fetched Guided Prayer rows keyed by UTC date "YYYY-MM-DD". */
    gpContent?: Map<string, GpContent>;
  },
  givingMultiplier?: number,
): Record<string, VariantSendGroup> {
  const byVariant: Record<string, VariantSendGroup> = {};

  for (const { user, variantId, scheduledAt, inLocalTime: isFallback } of inputs) {
    const meta = variantMeta.get(variantId);
    if (!meta) continue;
    const decisionId = decisionIdByUser.get(user.externalId);
    if (!decisionId) continue;

    const attrs = (user.attributes as Record<string, unknown>) ?? {};
    const tag = attrs.language_tag as string | undefined;

    let copy: LocalizedCopy = { title: meta.title, body: meta.body };
    let resolvedDeeplink: string | null;
    let copyKeyed: boolean;
    let verseImageId: string | undefined;
    let votdImage: { ios: string | null; android: string | null } | undefined;
    let gpImage: { ios: string | null; android: string | null } | undefined;

    if (meta.givingHandleStrategy != null) {
      // Dynamic giving handle: resolve a per-user ask amount + impact figure, then
      // substitute into copy and override the deeplink with the matching give-URL.
      const strategy = meta.givingHandleStrategy;
      const { amountLocal, currencyCode, amountUsd } = resolveLocalGiftAmount(attrs, strategy);
      const amountDisplay = formatGiftAmount(amountLocal, currencyCode);
      const bibles = computeBibles(amountUsd, givingMultiplier ?? DEFAULT_DOLLARS_TO_BIBLES);
      copy = {
        title: meta.title != null ? substituteGivingCopy(meta.title, { amountDisplay, bibles }) : null,
        body: substituteGivingCopy(meta.body, { amountDisplay, bibles }),
      };
      resolvedDeeplink = buildGivingDeeplink(attrs, strategy, meta.givingFrequency ?? "monthly");
      // Per-user copy → batch only users sharing identical resolved copy.
      copyKeyed = meta.channel === "push";
    } else {
      resolvedDeeplink = meta.deeplink === GIVING_LINK_SENTINEL
        ? buildGivingDeeplink(attrs, "blend", meta.givingFrequency ?? "monthly")
        : meta.deeplink;

      // VOTD liquid-tag arms resolve today's (user-local) localized verse from
      // the pre-fetched content map; verse-push arms (body sentinel) resolve a
      // rotated verse; otherwise fall back to the standard translation path.
      const isVotd = (localization?.votdVariantIds?.has(variantId) ?? false) && meta.channel === "push";
      const isGp   = (localization?.gpVariantIds?.has(variantId) ?? false) && meta.channel === "push";
      const verseStrategy = localization?.strategyByVariant?.get(variantId);
      const isVerse =
        !isVotd && !isGp && meta.body === VERSE_PUSH_SENTINEL && verseStrategy != null && localization?.versePool != null;
      if (isGp) {
        const date = scheduledAt.toISOString().slice(0, 10);
        const content = localization?.gpContent?.get(date);
        // Missing GP content → skip rather than deliver raw liquid tags.
        if (!content) continue;
        const labels = guidedLabels("en");
        copy = {
          title: meta.title != null ? substituteGpTags(meta.title, {
            guidedPrayerLabel: labels.guidedPrayer,
            gpReference: content.reference,
            gpText: content.verseText,
          }) : null,
          body: substituteGpTags(meta.body, {
            guidedPrayerLabel: labels.guidedPrayer,
            gpReference: content.reference,
            gpText: content.verseText,
          }),
        };
        gpImage = buildGpImageUrls(content.imageUrl);
      } else if (isVotd) {
        const key = resolveVotdUserKey(user.attributes, scheduledAt);
        const content = localization?.votdContent?.get(votdContentKey(key.date, key.languageTag));
        // Missing content → skip rather than deliver raw liquid tags.
        if (!content) continue;
        const labels = guidedLabels(content.languageTag);
        const subs = {
          guidedScriptureLabel: labels.guidedScripture,
          guidedPrayerLabel: labels.guidedPrayer,
          votdReference: content.reference,
          votdText: content.verseText,
        };
        copy = {
          title: meta.title != null ? substituteVotdTags(meta.title, subs) : null,
          body: substituteVotdTags(meta.body, subs),
        };
        votdImage = { ios: content.imageUrlIos, android: content.imageUrlAndroid };
      } else if (isVerse) {
        const dateBucket = scheduledAt.toISOString().slice(0, 10);
        const verse = pickVerse(localization!.versePool!, user.externalId, dateBucket);
        // Empty pool → skip rather than deliver the raw sentinel as a push body.
        if (!verse) continue;
        copy = resolveVerseCopy(verse, tag, verseStrategy!);
        verseImageId = verse.imageId;
      } else if (localization?.enabled && meta.channel === "push") {
        // Strict localization: skip recipients we cannot serve in their own language
        // rather than falling back to the English copy.
        const localized = resolvePushLocaleStrict(
          tag,
          localization.translationsByVariant.get(variantId) ?? new Map(),
          { title: meta.title, body: meta.body },
        );
        if (!localized) continue;
        copy = localized;
      }
      copyKeyed = meta.channel === "push" && (isVotd || isGp || isVerse || (localization?.enabled ?? false));
    }

    // Resolve per-platform image URLs (payload-determining → folded into the group key).
    let iosImageUrl: string | null = null;
    let androidImageUrl: string | null = null;
    if (meta.iconImageUrl === VERSE_IMAGE_SENTINEL) {
      if (votdImage && meta.channel === "push") {
        // VOTD arm: today's localized verse image (nullable → text-only send).
        iosImageUrl = votdImage.ios;
        androidImageUrl = votdImage.android;
      } else if (gpImage && meta.channel === "push") {
        // GP arm: today's morning prayer image (nullable → text-only send).
        iosImageUrl = gpImage.ios;
        androidImageUrl = gpImage.android;
      } else if (meta.body === VERSE_PUSH_SENTINEL && meta.channel === "push") {
        // Sentinel only resolves on a verse arm (we have a chosen verse). On a
        // non-verse arm the sentinel is meaningless → no image.
        const { ios, android } = buildVerseImageUrls(verseImageId ?? DEFAULT_VERSE_IMAGE_ID);
        iosImageUrl = ios;
        androidImageUrl = android;
      }
    } else if (meta.iconImageUrl) {
      iosImageUrl = meta.iconImageUrl;
      androidImageUrl = meta.iconImageUrl;
    }

    const groupInLocalTime = isFallback;
    const baseKey = `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}:${resolvedDeeplink ?? ""}`;
    // When copy is resolved per-user (localized push or a verse arm), users sharing
    // the same resolved copy must batch together; the copy fully determines the
    // payload, so key by it. \u0000 is a NUL field separator (cannot appear in
    // title/body) preventing title|body ambiguity.
    const imageKey = `${iosImageUrl ?? ""}\u0000${androidImageUrl ?? ""}`;
    const groupKey = (copyKeyed
      ? `${baseKey}:${copy.title ?? ""}\u0000${copy.body}`
      : baseKey) + `\u0000${imageKey}`;

    if (!byVariant[groupKey]) {
      byVariant[groupKey] = {
        variantId,
        brazeVariantId:  meta.brazeVariantId,
        brazeCampaignId: meta.brazeCampaignId,
        channel:         meta.channel,
        body:            copy.body,
        title:           copy.title,
        deeplink:        resolvedDeeplink,
        iosImageUrl,
        androidImageUrl,
        inLocalTime:     groupInLocalTime,
        scheduledAt,
        externalUserIds: [],
        brazeOnlyIds:    new Set(),
        decisionIds:     [],
      };
    }
    byVariant[groupKey].externalUserIds.push(user.externalId);
    // Unverified users have externalId === brazeId — flag them for braze_id targeting
    if (user.brazeId && user.externalId === user.brazeId) {
      byVariant[groupKey].brazeOnlyIds.add(user.externalId);
    }
    byVariant[groupKey].decisionIds.push(decisionId);
  }

  return byVariant;
}

// Send a batch of users for a variant group.
// Encapsulates channel switch, payload building, Braze POST, and brazeSendId update.
export async function sendVariantGroup(
  group: VariantSendGroup,
  batchUserIds: string[],
  batchDecisionIds: string[],
  brazeClient: ReturnType<typeof createBrazeClient>,
  factory: PayloadFactory,
  agentId: string,
  prisma: typeof import("@/lib/db").prisma,
  onSuccessfulBatch?: (userIds: string[]) => void,
): Promise<{ sent: number; errors: number }> {
  try {
    // BRAZE_NEXUS_CAMPAIGN_ID is the authoritative single Nexus campaign.
    // It takes precedence over per-message DB values so all sends flow through
    // one campaign and can be tracked in aggregate in Braze.
    const resolvedCampaignId =
      process.env.BRAZE_NEXUS_CAMPAIGN_ID ??
      group.brazeCampaignId ??
      undefined;

    // Use recipients[] format when the batch contains unverified users (braze_id only).
    // Verified users get { external_user_id }; unverified users get { braze_id }.
    const hasBrazeOnly = batchUserIds.some((id) => group.brazeOnlyIds.has(id));
    const audience = hasBrazeOnly
      ? { recipients: batchUserIds.map((id): BrazeRecipient =>
          group.brazeOnlyIds.has(id) ? { braze_id: id } : { external_user_id: id }
        )}
      : { externalUserIds: batchUserIds };
    let payload: Record<string, unknown>;

    if (group.channel === "push") {
      payload = factory.buildPushPayload(
        {
          title: group.title ?? "",
          body: group.body,
          deeplink: group.deeplink ?? undefined,
          iosImageUrl: group.iosImageUrl ?? undefined,
          androidImageUrl: group.androidImageUrl ?? undefined,
        },
        audience,
        resolvedCampaignId,
        group.brazeVariantId ?? undefined,
        group.inLocalTime,
      );
    } else if (group.channel === "email") {
      payload = factory.buildEmailPayload(
        { subject: group.title ?? "", htmlBody: group.body },
        audience,
        resolvedCampaignId,
        group.brazeVariantId ?? undefined,
        group.inLocalTime,
      );
    } else {
      payload = factory.buildSmsPayload(
        { body: group.body },
        audience,
        resolvedCampaignId,
        group.brazeVariantId ?? undefined,
        group.inLocalTime,
      );
    }

    // Route to scheduled endpoint when group has a future send time
    const endpoint = group.scheduledAt
      ? "/messages/schedule/create"
      : "/messages/send";

    if (group.scheduledAt) {
      payload = { ...payload, schedule: { time: group.scheduledAt.toISOString() } };
    }

    // Do NOT pass send_id to Braze — Braze Currents events carry Braze's auto-assigned
    // send_id back to us via /api/ingest/braze-events. We store a local UUID on
    // UserDecision only as an "accepted by Braze" marker for the daily cap check.
    const sendId = randomUUID();

    const res = await brazeClient!.post(endpoint, payload);
    if (res.ok) {
      // Parse schedule_id for scheduled sends (returned by /messages/schedule/create)
      let brazeScheduleId: string | null = null;
      if (group.scheduledAt) {
        try {
          const json = await res.json() as { schedule_id?: string };
          brazeScheduleId = json.schedule_id ?? null;
        } catch { /* ignore parse errors */ }
      }
      // Persist tracking IDs on decisions so the analytics cron can match them
      await prisma.userDecision.updateMany({
        where: { id: { in: batchDecisionIds } },
        data: {
          brazeSendId: sendId,
          ...(brazeScheduleId && { brazeScheduleId }),
        },
      });
      if (onSuccessfulBatch) {
        onSuccessfulBatch(batchUserIds);
      }
      return { sent: batchUserIds.length, errors: 0 };
    } else {
      // HTTP-level Braze error (non-exception path) — record failure, don't count as sent
      let responseBody: unknown;
      try { responseBody = await res.json(); } catch { responseBody = null; }
      const reason = `HTTP ${res.status}: ${JSON.stringify(responseBody)}`;
      console.error("[cron/select-and-send] Braze HTTP error:", reason, { variantId: group.variantId });
      void prisma.failedBrazeSend.create({
        data: {
          agentId,
          variantId: group.variantId,
          channel:    group.channel,
          userIds:    batchUserIds,
          decisionIds: batchDecisionIds,
          reason,
        },
      }).catch((dbErr: unknown) => {
        console.error("[cron/select-and-send] Failed to write FailedBrazeSend record:", dbErr);
      });
      return { sent: 0, errors: batchUserIds.length };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[cron/select-and-send] Braze send error:", err);
    void prisma.failedBrazeSend.create({
      data: {
        agentId,
        variantId: group.variantId,
        channel:   group.channel,
        userIds:   batchUserIds,
        decisionIds: batchDecisionIds,
        reason,
      },
    }).catch((dbErr: unknown) => {
      console.error("[cron/select-and-send] Failed to write FailedBrazeSend record:", dbErr);
    });
    return { sent: 0, errors: batchUserIds.length };
  }
}

/**
 * Split each variant group into BATCH-sized chunks and POST them to Braze with
 * bounded concurrency. Returns aggregate counts and the externalIds Braze
 * accepted (used by the in-window pool to bump sendCount).
 */
export async function dispatchSendGroups(
  groups: VariantSendGroup[],
  ctx: {
    brazeClient: ReturnType<typeof createBrazeClient>;
    factory: PayloadFactory;
    agentId: string;
    prisma: typeof import("@/lib/db").prisma;
  },
): Promise<{ sent: number; errors: number; sentUserIds: string[] }> {
  const BATCH = 50;
  const CONCURRENCY = 50;
  const tasks: Array<() => Promise<{ sent: number; errors: number; userIds: string[] }>> = [];
  for (const group of groups) {
    for (let i = 0; i < group.externalUserIds.length; i += BATCH) {
      const batchUserIds = group.externalUserIds.slice(i, i + BATCH);
      const batchDecisionIds = group.decisionIds.slice(i, i + BATCH);
      tasks.push(async () => {
        const localSent: string[] = [];
        const result = await sendVariantGroup(
          group, batchUserIds, batchDecisionIds, ctx.brazeClient, ctx.factory, ctx.agentId, ctx.prisma,
          (userIds) => localSent.push(...userIds),
        );
        return { ...result, userIds: localSent };
      });
    }
  }

  let sent = 0;
  let errors = 0;
  const sentUserIds: string[] = [];
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const results = await Promise.allSettled(tasks.slice(i, i + CONCURRENCY).map((t) => t()));
    for (const r of results) {
      if (r.status === "fulfilled") {
        sent += r.value.sent;
        errors += r.value.errors;
        sentUserIds.push(...r.value.userIds);
      } else {
        errors++;
      }
    }
  }

  return { sent, errors, sentUserIds };
}
