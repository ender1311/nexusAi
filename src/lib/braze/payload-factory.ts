import { assetFileTypeFromUrl } from "@/lib/verse-image";

interface PushMessage {
  title: string;
  body: string;
  deeplink?: string;
  iconImageUrl?: string;
  /** iOS-specific image (square). Falls back to iconImageUrl. */
  iosImageUrl?: string;
  /** Android-specific image (2:1). Falls back to iconImageUrl. */
  androidImageUrl?: string;
  extraData?: Record<string, unknown>;
}

interface EmailMessage {
  subject: string;
  htmlBody: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
}

interface SmsMessage {
  body: string;
}

interface ContentCardMessage {
  title: string;
  message: string;
  cta: string | null;
  link: string | null;
}

// Braze recipient: exactly one identifier per entry (external_user_id OR braze_id).
// Used when a batch contains unverified users who have no external_user_id in Braze.
export type BrazeRecipient =
  | { external_user_id: string; braze_id?: never }
  | { braze_id: string; external_user_id?: never };

interface AudienceTarget {
  externalUserIds?: string[];
  segmentId?: string;
  /** Per-recipient identifier array — use instead of externalUserIds when the batch
   *  contains unverified users (braze_id only). Supports mixing both identifier types. */
  recipients?: BrazeRecipient[];
}

export class PayloadFactory {
  private androidAppId?: string;
  private iosAppId?: string;
  private nexusIosVariantId?: string;
  private nexusAndroidVariantId?: string;
  private nexusEmailVariantId?: string;
  private nexusContentCardVariantId?: string;

  constructor(opts?: {
    androidAppId?: string;
    iosAppId?: string;
    nexusIosVariantId?: string;
    nexusAndroidVariantId?: string;
    nexusEmailVariantId?: string;
    nexusContentCardVariantId?: string;
  }) {
    this.androidAppId = opts?.androidAppId ?? process.env.BRAZE_ANDROID_APP_ID;
    this.iosAppId = opts?.iosAppId ?? process.env.BRAZE_IOS_APP_ID;
    this.nexusIosVariantId = opts?.nexusIosVariantId ?? process.env.BRAZE_NEXUS_IOS_VARIANT_ID;
    this.nexusAndroidVariantId = opts?.nexusAndroidVariantId ?? process.env.BRAZE_NEXUS_ANDROID_VARIANT_ID;
    this.nexusEmailVariantId = opts?.nexusEmailVariantId ?? process.env.BRAZE_NEXUS_EMAIL_VARIANT_ID;
    this.nexusContentCardVariantId = opts?.nexusContentCardVariantId ?? process.env.BRAZE_NEXUS_CONTENTCARD_VARIANT_ID;
  }

  buildPushPayload(
    msg: PushMessage,
    audience: AudienceTarget,
    campaignId?: string,
    variantId?: string,
    inLocalTime?: boolean
  ): Record<string, unknown> {
    // Use platform-specific env var fallbacks when no per-variant DB ID is set.
    // message_variation_id requires campaign_id — only include it when a campaign is present.
    const resolvedAndroidVariantId = campaignId ? (variantId ?? this.nexusAndroidVariantId) : variantId;
    const resolvedIosVariantId = campaignId ? (variantId ?? this.nexusIosVariantId) : variantId;

    const androidImage = msg.androidImageUrl ?? msg.iconImageUrl;
    const iosImage = msg.iosImageUrl ?? msg.iconImageUrl;

    const androidMsg: Record<string, unknown> = {
      alert: msg.body,
      title: msg.title,
      ...(msg.deeplink && { custom_uri: msg.deeplink }),
      ...(androidImage && { image_url: androidImage }),
      ...(msg.extraData && { extra: msg.extraData }),
      ...(resolvedAndroidVariantId && { message_variation_id: resolvedAndroidVariantId }),
      ...((audience.externalUserIds || audience.recipients) && { app_id: this.androidAppId }),
    };

    const appleMsg: Record<string, unknown> = {
      alert: { body: msg.body, title: msg.title },
      ...(msg.deeplink && { custom_uri: msg.deeplink }),
      ...(iosImage && { asset_url: iosImage, asset_file_type: assetFileTypeFromUrl(iosImage) }),
      ...(msg.extraData && { extra: msg.extraData }),
      ...(resolvedIosVariantId && { message_variation_id: resolvedIosVariantId }),
      ...((audience.externalUserIds || audience.recipients) && { app_id: this.iosAppId }),
    };

    return {
      ...(campaignId && { campaign_id: campaignId }),
      ...(inLocalTime && { in_local_time: true }),
      messages: { android_push: androidMsg, apple_push: appleMsg },
      ...this.buildAudience(audience),
    };
  }

  buildEmailPayload(
    msg: EmailMessage,
    audience: AudienceTarget,
    campaignId?: string,
    variantId?: string,
    inLocalTime?: boolean
  ): Record<string, unknown> {
    const fromName = msg.fromName ?? "YouVersion";
    const fromEmail = msg.fromEmail ?? "no-reply@youversion.com";

    const resolvedVariantId = variantId ?? this.nexusEmailVariantId;

    const emailMsg: Record<string, unknown> = {
      subject: msg.subject,
      body: msg.htmlBody,
      from: `${fromName} <${fromEmail}>`,
      reply_to: msg.replyTo ?? fromEmail,
      ...(resolvedVariantId && { message_variation_id: resolvedVariantId }),
    };

    return {
      ...(campaignId && { campaign_id: campaignId }),
      ...(inLocalTime && { in_local_time: true }),
      messages: { email: emailMsg },
      ...this.buildAudience(audience),
    };
  }

  buildSmsPayload(
    msg: SmsMessage,
    audience: AudienceTarget,
    campaignId?: string,
    variantId?: string,
    inLocalTime?: boolean
  ): Record<string, unknown> {
    return {
      ...(campaignId && { campaign_id: campaignId }),
      ...(inLocalTime && { in_local_time: true }),
      messages: {
        sms: {
          body: msg.body,
          ...(variantId && { message_variation_id: variantId }),
        },
      },
      ...this.buildAudience(audience),
    };
  }

  /**
   * Build a /campaigns/trigger/send payload for an API-triggered content card.
   * The Braze campaign uses {{api_trigger_properties.${title}}}, ${message},
   * ${cta}, ${link} as liquid variables — we resolve them here and pass as
   * trigger_properties shared by all recipients in the batch.
   */
  buildContentCardApiTriggerPayload(
    msg: ContentCardMessage,
    audience: AudienceTarget,
    campaignId: string,
  ): Record<string, unknown> {
    const trigger_properties: Record<string, string> = {
      title: msg.title,
      message: msg.message,
    };
    if (msg.cta) trigger_properties.cta = msg.cta;
    if (msg.link) trigger_properties.link = msg.link;

    // Build recipients array. When mixed braze_id/external_user_id batch,
    // use recipients[]; otherwise use the flatter external_user_ids format.
    const hasBrazeOnly = audience.recipients?.some((r) => "braze_id" in r);
    const recipientList =
      audience.recipients ??
      (audience.externalUserIds?.map((id) => ({ external_user_id: id })) ?? []);

    if (hasBrazeOnly || audience.recipients) {
      return { campaign_id: campaignId, trigger_properties, recipients: recipientList };
    }
    return {
      campaign_id: campaignId,
      trigger_properties,
      ...(audience.externalUserIds?.length
        ? { recipients: audience.externalUserIds.map((id) => ({ external_user_id: id })) }
        : {}),
    };
  }

  /** Exposed so callers can look up the env-based content card variant ID. */
  get contentCardVariantId(): string | undefined {
    return this.nexusContentCardVariantId;
  }

  private buildAudience(audience: AudienceTarget): Record<string, unknown> {
    if (audience.recipients?.length) {
      return { recipients: audience.recipients };
    }
    if (audience.externalUserIds?.length) {
      return { external_user_ids: audience.externalUserIds };
    }
    if (audience.segmentId) {
      return { segment_id: audience.segmentId, broadcast: true };
    }
    return {};
  }
}
