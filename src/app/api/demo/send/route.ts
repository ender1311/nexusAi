import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { decideForUser } from "@/lib/decide";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { randomUUID } from "crypto";
import { hasVotdTags, hasGpTags, substituteVotdTags, substituteGpTags } from "@/lib/votd/votd-tags";
import { guidedLabels } from "@/lib/votd/labels";
import { resolveVotdUserKey } from "@/lib/votd/votd-user-key";
import { getVotdContent } from "@/lib/votd/votd-content";
import { getGpContent, buildGpImageUrls } from "@/lib/votd/guided-prayer-content";
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";
import { parseMultiplier } from "@/lib/engine/giving-copy";
import { deriveGivingStrategy, deriveGivingFrequency, deriveGivingDefaultUsd, resolveGivingHandle, hasUnsubstitutedTokens } from "@/lib/engine/giving-handle";

type SendResult = {
  userId: string;
  status: "sent" | "suppressed" | "failed";
  variantName?: string;
  reason?: string;
};

// Legacy types retained for LiveDemoWizard which uses the preview→send flow
export type DemoSendResult = {
  userId: string;
  status: "sent" | "error" | "skipped";
  error?: string;
};

export type DemoSendResponse = {
  results: DemoSendResult[];
  sent: number;
  errors: number;
  skipped: number;
};

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { agentId, userIds, bypassQuietHours, bypassFrequencyCap, variantOverrideId } = (body ?? {}) as Record<string, unknown>;
  if (typeof agentId !== "string" || !Array.isArray(userIds) || userIds.length === 0) {
    return NextResponse.json({ error: "agentId and non-empty userIds array required" }, { status: 400 });
  }
  const overrideVariantId = typeof variantOverrideId === "string" ? variantOverrideId : undefined;
  if (userIds.length > 20) {
    return NextResponse.json({ error: "Max 20 users per demo send" }, { status: 400 });
  }
  if (!userIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "userIds must be strings" }, { status: 400 });
  }
  const forceOverrideQuietHours = bypassQuietHours === true;
  const forceOverrideFrequencyCap = bypassFrequencyCap === true;

  const brazeClient = createBrazeClient();
  const factory = brazeClient ? new PayloadFactory() : null;
  const campaignId = process.env.BRAZE_NEXUS_CAMPAIGN_ID;
  const multiplierSetting = await prisma.appSetting.findUnique({ where: { key: "giving_dollars_to_bibles_multiplier" } });
  const givingMultiplier = parseMultiplier(multiplierSetting?.value);

  const results: SendResult[] = await Promise.all(
    (userIds as string[]).map(async (userId): Promise<SendResult> => {
      try {
        let brazeVariantId: string | null = null;
        let variantName: string | undefined;

        if (overrideVariantId) {
          // Verify this variant belongs to the requested agent before using it.
          const overrideVariant = await prisma.messageVariant.findFirst({
            where: {
              id: overrideVariantId,
              message: { agentId },
            },
            select: { id: true, name: true, title: true, body: true, deeplink: true, iconImageUrl: true, brazeVariantId: true, subcategory: true, actionFeatures: true },
          });
          if (!overrideVariant) return { userId, status: "failed", reason: "override variant not found for this agent" };
          brazeVariantId = overrideVariant.brazeVariantId;
          variantName = overrideVariant.name;

          let title = overrideVariant.title ?? "";
          let body = overrideVariant.body;
          let deeplink: string | undefined = overrideVariant.deeplink ?? undefined;
          let iosImageUrl: string | undefined;
          let androidImageUrl: string | undefined;

          const givingStrategy = deriveGivingStrategy(overrideVariant.subcategory, overrideVariant.actionFeatures);
          if (givingStrategy != null) {
            // Dynamic giving handle — resolve {{ask}}/{{bibles}} + the give deeplink
            // (same logic as the cron). Without this the demo shipped raw tokens.
            const tu = await prisma.trackedUser.findUnique({ where: { externalId: userId }, select: { attributes: true } });
            const resolved = resolveGivingHandle({
              title: overrideVariant.title, body: overrideVariant.body, explicitDeeplink: overrideVariant.deeplink,
              strategy: givingStrategy, frequency: deriveGivingFrequency(overrideVariant.actionFeatures),
              defaultUsd: deriveGivingDefaultUsd(overrideVariant.actionFeatures),
              attrs: (tu?.attributes ?? {}) as Record<string, unknown>, multiplier: givingMultiplier,
            });
            title = resolved.title ?? "";
            body = resolved.body;
            deeplink = resolved.deeplink;
          } else if (hasGpTags(overrideVariant.title, overrideVariant.body)) {
            const trackedUserForGp = await prisma.trackedUser.findUnique({
              where: { externalId: userId },
              select: { attributes: true },
            });
            const gpKey = resolveVotdUserKey(trackedUserForGp?.attributes ?? {}, new Date());
            const content = await getGpContent(prisma, gpKey.date, gpKey.languageTag);
            if (!content) return { userId, status: "failed" as const, variantName, reason: "GP content unavailable" };
            const labels = guidedLabels(content.languageTag);
            const subs = { guidedPrayerLabel: labels.guidedPrayer, gpReference: content.reference, gpText: content.verseText };
            title = substituteGpTags(title, subs);
            body = substituteGpTags(body, subs);
            if (overrideVariant.iconImageUrl === VERSE_IMAGE_SENTINEL) {
              const imgs = buildGpImageUrls(content.imageUrl);
              iosImageUrl = imgs.ios ?? undefined;
              androidImageUrl = imgs.android ?? undefined;
            }
          } else if (hasVotdTags(overrideVariant.title, overrideVariant.body)) {
            const trackedUser = await prisma.trackedUser.findUnique({
              where: { externalId: userId },
              select: { attributes: true },
            });
            const key = resolveVotdUserKey(trackedUser?.attributes ?? {}, new Date());
            const content = await getVotdContent(prisma, key.date, key.languageTag);
            if (!content) return { userId, status: "failed" as const, variantName, reason: "VOTD content unavailable" };
            const labels = guidedLabels(content.languageTag);
            title = substituteVotdTags(title, { guidedScriptureLabel: labels.guidedScripture, guidedPrayerLabel: labels.guidedPrayer, votdReference: content.reference, votdText: content.verseText });
            body = substituteVotdTags(body, { guidedScriptureLabel: labels.guidedScripture, guidedPrayerLabel: labels.guidedPrayer, votdReference: content.reference, votdText: content.verseText });
            if (overrideVariant.iconImageUrl === VERSE_IMAGE_SENTINEL) {
              iosImageUrl = content.imageUrlIos ?? undefined;
              androidImageUrl = content.imageUrlAndroid ?? undefined;
            }
          }

          if (hasUnsubstitutedTokens(title, body)) return { userId, status: "failed", variantName, reason: "unresolved template tokens — not sent" };
          if (!brazeClient || !factory) return { userId, status: "failed", reason: "Braze not configured", variantName };
          const payload = factory.buildPushPayload(
            { title, body, deeplink, iosImageUrl, androidImageUrl },
            { externalUserIds: [userId] },
            campaignId,
            brazeVariantId ?? undefined,
            false,
          );
          const res = await brazeClient.post("/messages/send", payload);
          if (!res.ok) return { userId, status: "failed", reason: "Braze send failed", variantName };
          // Override sends intentionally skip UserDecision creation — they are test
          // sends, not bandit selections, and should not pollute analytics or frequency cap.
          return { userId, status: "sent", variantName };
        }

        const decision = await decideForUser({ agentId, externalUserId: userId, bypassQuietHours: forceOverrideQuietHours, bypassFrequencyCap: forceOverrideFrequencyCap, allowInactive: true });
        if (!decision) return { userId, status: "failed", reason: "agent not found or no variants" };
        if (decision.suppressed) return { userId, status: "suppressed", reason: decision.reason };

        const variant = await prisma.messageVariant.findUnique({
          where: { id: decision.messageVariantId },
          select: {
            name: true,
            title: true,
            body: true,
            deeplink: true,
            iconImageUrl: true,
            subcategory: true,
            actionFeatures: true,
          },
        });
        if (!variant) return { userId, status: "failed", reason: "variant not found" };

        let title = variant.title ?? "";
        let body = variant.body;
        let deeplink: string | undefined = variant.deeplink ?? decision.deeplink ?? undefined;
        let iosImageUrl: string | undefined;
        let androidImageUrl: string | undefined;

        const givingStrategy = deriveGivingStrategy(variant.subcategory, variant.actionFeatures);
        if (givingStrategy != null) {
          const tu = await prisma.trackedUser.findUnique({ where: { externalId: userId }, select: { attributes: true } });
          const resolved = resolveGivingHandle({
            title: variant.title, body: variant.body, explicitDeeplink: variant.deeplink,
            strategy: givingStrategy, frequency: deriveGivingFrequency(variant.actionFeatures),
            defaultUsd: deriveGivingDefaultUsd(variant.actionFeatures),
            attrs: (tu?.attributes ?? {}) as Record<string, unknown>, multiplier: givingMultiplier,
          });
          title = resolved.title ?? "";
          body = resolved.body;
          deeplink = resolved.deeplink;
        } else if (hasGpTags(variant.title, variant.body)) {
          const trackedUserForGp = await prisma.trackedUser.findUnique({
            where: { externalId: userId },
            select: { attributes: true },
          });
          const gpKey = resolveVotdUserKey(trackedUserForGp?.attributes ?? {}, new Date());
          const content = await getGpContent(prisma, gpKey.date, gpKey.languageTag);
          if (!content) {
            return { userId, status: "failed" as const, variantName: variant.name, reason: "GP content unavailable" };
          }
          const labels = guidedLabels(content.languageTag);
          const subs = { guidedPrayerLabel: labels.guidedPrayer, gpReference: content.reference, gpText: content.verseText };
          title = substituteGpTags(title, subs);
          body = substituteGpTags(body, subs);
          if (variant.iconImageUrl === VERSE_IMAGE_SENTINEL) {
            const imgs = buildGpImageUrls(content.imageUrl);
            iosImageUrl = imgs.ios ?? undefined;
            androidImageUrl = imgs.android ?? undefined;
          }
        } else if (hasVotdTags(variant.title, variant.body)) {
          const trackedUser = await prisma.trackedUser.findUnique({
            where: { externalId: userId },
            select: { attributes: true },
          });
          const key = resolveVotdUserKey(trackedUser?.attributes ?? {}, new Date());
          const content = await getVotdContent(prisma, key.date, key.languageTag);
          if (!content) {
            return {
              userId,
              status: "failed" as const,
              variantName: variant.name,
              reason: "VOTD content unavailable",
            };
          }
          const labels = guidedLabels(content.languageTag);
          const subs = {
            guidedScriptureLabel: labels.guidedScripture,
            guidedPrayerLabel: labels.guidedPrayer,
            votdReference: content.reference,
            votdText: content.verseText,
          };
          title = substituteVotdTags(title, subs);
          body = substituteVotdTags(body, subs);
          if (variant.iconImageUrl === VERSE_IMAGE_SENTINEL) {
            iosImageUrl = content.imageUrlIos ?? undefined;
            androidImageUrl = content.imageUrlAndroid ?? undefined;
          }
        }

        if (hasUnsubstitutedTokens(title, body)) {
          return { userId, status: "failed", variantName: variant.name, reason: "unresolved template tokens — not sent" };
        }
        if (!brazeClient || !factory) {
          return { userId, status: "failed", reason: "Braze not configured", variantName: variant.name };
        }

        const payload = factory.buildPushPayload(
          {
            title,
            body,
            deeplink,
            iosImageUrl,
            androidImageUrl,
          },
          { externalUserIds: [userId] },
          campaignId,
          decision.brazeVariantId ?? undefined,
          false,
        );

        const res = await brazeClient.post("/messages/send", payload);
        if (!res.ok) {
          console.error("[demo/send] Braze error:", res.status, userId);
          return { userId, status: "failed", reason: "Braze send failed", variantName: variant.name };
        }

        await prisma.userDecision.update({
          where: { id: decision.userDecisionId },
          data: { brazeSendId: randomUUID() },
        }).catch((err) => console.warn("[demo/send] userDecision update failed (non-critical):", err));

        return { userId, status: "sent", variantName: variant.name };
      } catch (err) {
        console.error("[demo/send] error for user", userId, err);
        return { userId, status: "failed", reason: "internal error" };
      }
    })
  );

  return NextResponse.json({ data: results });
}
