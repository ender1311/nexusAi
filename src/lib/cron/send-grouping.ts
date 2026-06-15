import { randomUUID } from "crypto";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import type { BrazeRecipient } from "@/lib/braze/payload-factory";
import {
  GIVING_LINK_SENTINEL,
  DEFAULT_HANDLE_USD,
  buildGivingDeeplink,
  type GivingHandleStrategy,
  type GivingFrequency,
} from "@/lib/engine/giving-link";
import { DEFAULT_DOLLARS_TO_BIBLES } from "@/lib/engine/giving-copy";
import { resolveGivingHandle, hasUnsubstitutedTokens } from "@/lib/engine/giving-handle";
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
  cta: string | null;
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
  cta: string | null;
  deeplink: string | null;
  brazeCampaignId: string | null;
  brazeVariantId: string | null;
  /** Non-null marks a dynamic-handle variant; selects the per-user ask strategy. */
  givingHandleStrategy: GivingHandleStrategy | null;
  /** One-time vs recurring give-page mode for resolved giving deeplinks. Defaults to "monthly". */
  givingFrequency?: GivingFrequency;
  /** Per-variant default ask (USD) for never-givers; clamped to $5–$100. Defaults to $25. */
  givingHandleDefaultUsd?: number;
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
    /** Pre-fetched Guided Prayer rows keyed by user-local date "YYYY-MM-DD" (America/Chicago fallback). */
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
      // Dynamic giving handle: resolve the per-user ask + impact, substitute
      // {{ask}}/{{bibles}}, and pick the deeplink. Shared with the demo send path
      // via resolveGivingHandle so the two can't diverge.
      const resolved = resolveGivingHandle({
        title: meta.title,
        body: meta.body,
        explicitDeeplink: meta.deeplink,
        strategy: meta.givingHandleStrategy,
        frequency: meta.givingFrequency ?? "monthly",
        defaultUsd: meta.givingHandleDefaultUsd ?? DEFAULT_HANDLE_USD,
        attrs,
        multiplier: givingMultiplier ?? DEFAULT_DOLLARS_TO_BIBLES,
      });
      copy = { title: resolved.title, body: resolved.body };
      resolvedDeeplink = resolved.deeplink;
      // Per-user copy → batch only users sharing identical resolved copy. Always
      // key on resolved copy for dynamic-handle (the amount/impact is per-user on
      // every channel), so a non-push dynamic-handle variant can't collapse users
      // with different asks into one payload.
      copyKeyed = true;
    } else {
      resolvedDeeplink = meta.deeplink === GIVING_LINK_SENTINEL
        ? buildGivingDeeplink(attrs, "blend", meta.givingFrequency ?? "monthly", meta.givingHandleDefaultUsd ?? DEFAULT_HANDLE_USD)
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
        const { date: gpDate } = resolveVotdUserKey(user.attributes, scheduledAt);
        const content = localization?.gpContent?.get(gpDate);
        // Missing GP content → skip rather than deliver raw liquid tags.
        if (!content) {
          console.warn("[send-grouping] GP content missing for date", gpDate, "— skipping user", user.externalId);
          continue;
        }
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

    // Defense in depth: never ship a push with an unsubstituted {{token}} — Braze
    // renders unknown {{...}} as blank (the giving-handle demo bug). Skip + warn so
    // a templating gap is visible instead of silently sending a broken message.
    if (hasUnsubstitutedTokens(copy.title, copy.body)) {
      console.warn(`[send-grouping] skip ${user.externalId} on variant ${variantId} — unresolved template token in resolved copy`);
      continue;
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
    } else if (meta.iconImageUrl && meta.channel !== "content-card") {
      // content-card sends don't accept a dynamic imageUrl via trigger_properties,
      // so don't set iosImageUrl/androidImageUrl for that channel. Including it in
      // the group key would split users with different iconImageUrls into separate
      // Braze calls even though the payloads would be identical (image never sent).
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
        cta:             meta.cta,
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

    if (group.channel === "content-card") {
      // API-triggered content card: uses /campaigns/trigger/send (immediate) or
      // /campaigns/trigger/schedule/create (future). Trigger properties resolve
      // the Liquid variables in the campaign template (title, message, cta, link).
      // Never fall back to the push campaign for content-card sends — a push
      // campaign ID used with /campaigns/trigger/send for a content-card would
      // be silently rejected or return a confusing Braze error.
      const ccCampaignId =
        process.env.BRAZE_CONTENT_CARD_CAMPAIGN_ID ??
        group.brazeCampaignId ??
        undefined;
      if (!ccCampaignId) {
        console.error("[cron/select-and-send] content-card send skipped: no campaign ID (set BRAZE_CONTENT_CARD_CAMPAIGN_ID)");
        return { sent: 0, errors: batchUserIds.length };
      }
      payload = factory.buildContentCardApiTriggerPayload(
        {
          title: group.title ?? "",
          message: group.body,
          cta: group.cta ?? null,
          link: group.deeplink ?? null,
        },
        audience,
        ccCampaignId,
      );
      // Content cards set scheduledAt=now (sendImmediately path in the cron), not a
      // future time. Use a 2-minute threshold to distinguish true future schedules
      // from "send now" — otherwise every content-card would hit the schedule/create
      // endpoint and Braze would receive a schedule time in the past.
      const ccIsFuture = !!group.scheduledAt && group.scheduledAt.getTime() > Date.now() + 120_000;
      const ccEndpoint = ccIsFuture
        ? "/campaigns/trigger/schedule/create"
        : "/campaigns/trigger/send";
      if (ccIsFuture) {
        payload = { ...payload, schedule: { time: group.scheduledAt!.toISOString() } };
      }
      const res = await brazeClient!.post(ccEndpoint, payload);
      if (res.ok) {
        const sendId = randomUUID();
        let brazeScheduleId: string | null = null;
        if (ccIsFuture) {
          try {
            const json = await res.json() as { schedule_id?: string };
            brazeScheduleId = json.schedule_id ?? null;
          } catch { /* ignore */ }
        }
        await prisma.userDecision.updateMany({
          where: { id: { in: batchDecisionIds } },
          data: { brazeSendId: sendId, ...(brazeScheduleId && { brazeScheduleId }) },
        });
        if (onSuccessfulBatch) onSuccessfulBatch(batchUserIds);
        return { sent: batchUserIds.length, errors: 0 };
      } else {
        let responseBody: unknown;
        try { responseBody = await res.json(); } catch { responseBody = null; }
        const reason = `HTTP ${res.status}: ${JSON.stringify(responseBody)}`;
        console.error("[cron/select-and-send] content-card Braze HTTP error:", reason, { variantId: group.variantId });
        void prisma.failedBrazeSend.create({
          data: { agentId, variantId: group.variantId, channel: group.channel, userIds: batchUserIds, decisionIds: batchDecisionIds, reason },
        }).catch((dbErr: unknown) => {
          console.error("[cron/select-and-send] Failed to write FailedBrazeSend record:", dbErr);
        });
        return { sent: 0, errors: batchUserIds.length };
      }
    }

    if (group.channel === "in-app") {
      // Canvas-triggered slideup: uses /canvas/trigger/send (immediate) or
      // /canvas/trigger/schedule/create (future). Canvas entry properties drive
      // the Decision Split (slideupOnly) and populate push + slideup steps.
      const canvasId =
        process.env.BRAZE_NEXUS_SLIDEUP_CANVAS_ID ??
        group.brazeCampaignId ??
        undefined;
      if (!canvasId) {
        console.error("[cron/select-and-send] in-app send skipped: no canvas ID (set BRAZE_NEXUS_SLIDEUP_CANVAS_ID)");
        return { sent: 0, errors: batchUserIds.length };
      }
      payload = factory.buildCanvasApiTriggerPayload(
        {
          title: group.title ?? null,
          message: group.body,
          link: group.deeplink ?? null,
          imageUrl: group.iosImageUrl ?? null,
        },
        audience,
        canvasId,
      );
      // Slideup-only variants set scheduledAt=now (sendImmediately path); use the
      // same 2-minute threshold as content cards to avoid the schedule/create endpoint
      // receiving a past or present timestamp.
      const canvasIsFuture = !!group.scheduledAt && group.scheduledAt.getTime() > Date.now() + 120_000;
      const canvasEndpoint = canvasIsFuture
        ? "/canvas/trigger/schedule/create"
        : "/canvas/trigger/send";
      if (canvasIsFuture) {
        payload = { ...payload, schedule: { time: group.scheduledAt!.toISOString() } };
      }
      const res = await brazeClient!.post(canvasEndpoint, payload);
      if (res.ok) {
        const sendId = randomUUID();
        let brazeScheduleId: string | null = null;
        if (canvasIsFuture) {
          try {
            const json = await res.json() as { schedule_id?: string };
            brazeScheduleId = json.schedule_id ?? null;
          } catch { /* ignore */ }
        }
        await prisma.userDecision.updateMany({
          where: { id: { in: batchDecisionIds } },
          data: { brazeSendId: sendId, ...(brazeScheduleId && { brazeScheduleId }) },
        });
        if (onSuccessfulBatch) onSuccessfulBatch(batchUserIds);
        return { sent: batchUserIds.length, errors: 0 };
      } else {
        let responseBody: unknown;
        try { responseBody = await res.json(); } catch { responseBody = null; }
        const reason = `HTTP ${res.status}: ${JSON.stringify(responseBody)}`;
        console.error("[cron/select-and-send] in-app Braze HTTP error:", reason, { variantId: group.variantId });
        void prisma.failedBrazeSend.create({
          data: { agentId, variantId: group.variantId, channel: group.channel, userIds: batchUserIds, decisionIds: batchDecisionIds, reason },
        }).catch((dbErr: unknown) => {
          console.error("[cron/select-and-send] Failed to write FailedBrazeSend record:", dbErr);
        });
        return { sent: 0, errors: batchUserIds.length };
      }
    }

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
