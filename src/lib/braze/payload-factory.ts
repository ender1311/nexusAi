interface PushMessage {
  title: string;
  body: string;
  deeplink?: string;
  iconImageUrl?: string;
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

interface AudienceTarget {
  externalUserIds?: string[];
  segmentId?: string;
}

export class PayloadFactory {
  private androidAppId?: string;
  private iosAppId?: string;

  constructor(opts?: { androidAppId?: string; iosAppId?: string }) {
    this.androidAppId = opts?.androidAppId ?? process.env.BRAZE_ANDROID_APP_ID;
    this.iosAppId = opts?.iosAppId ?? process.env.BRAZE_IOS_APP_ID;
  }

  buildPushPayload(
    msg: PushMessage,
    audience: AudienceTarget,
    campaignId?: string,
    sendId?: string,
    variantId?: string,
    sendAt?: string
  ): Record<string, unknown> {
    const androidMsg: Record<string, unknown> = {
      alert: msg.body,
      title: msg.title,
      ...(msg.deeplink && { custom_uri: msg.deeplink }),
      ...(msg.iconImageUrl && { image_url: msg.iconImageUrl }),
      ...(msg.extraData && { extra: msg.extraData }),
      ...(variantId && { message_variation_id: variantId }),
      ...(audience.externalUserIds && { app_id: this.androidAppId }),
    };

    const appleMsg: Record<string, unknown> = {
      alert: { body: msg.body, title: msg.title },
      ...(msg.deeplink && { custom_uri: msg.deeplink }),
      ...(msg.iconImageUrl && {
        rich_notification: { media_url: msg.iconImageUrl, media_type: "img" },
      }),
      ...(msg.extraData && { extra: msg.extraData }),
      ...(variantId && { message_variation_id: variantId }),
      ...(audience.externalUserIds && { app_id: this.iosAppId }),
    };

    return {
      ...(campaignId && { campaign_id: campaignId }),
      ...(sendId && { send_id: sendId }),
      ...(sendAt && { send_at: sendAt }),
      messages: { android_push: androidMsg, apple_push: appleMsg },
      ...this.buildAudience(audience),
    };
  }

  buildEmailPayload(
    msg: EmailMessage,
    audience: AudienceTarget,
    campaignId?: string,
    sendId?: string,
    variantId?: string,
    sendAt?: string
  ): Record<string, unknown> {
    const fromName = msg.fromName ?? "YouVersion";
    const fromEmail = msg.fromEmail ?? "no-reply@youversion.com";

    const emailMsg: Record<string, unknown> = {
      subject: msg.subject,
      body: msg.htmlBody,
      from: `${fromName} <${fromEmail}>`,
      reply_to: msg.replyTo ?? fromEmail,
      app_id: this.iosAppId,
      ...(variantId && { message_variation_id: variantId }),
    };

    return {
      ...(campaignId && { campaign_id: campaignId }),
      ...(sendId && { send_id: sendId }),
      ...(sendAt && { send_at: sendAt }),
      messages: { email: emailMsg },
      ...this.buildAudience(audience),
    };
  }

  buildSmsPayload(
    msg: SmsMessage,
    audience: AudienceTarget,
    campaignId?: string,
    sendId?: string,
    variantId?: string,
    sendAt?: string
  ): Record<string, unknown> {
    return {
      ...(campaignId && { campaign_id: campaignId }),
      ...(sendId && { send_id: sendId }),
      ...(sendAt && { send_at: sendAt }),
      messages: {
        sms: {
          body: msg.body,
          ...(variantId && { message_variation_id: variantId }),
        },
      },
      ...this.buildAudience(audience),
    };
  }

  private buildAudience(audience: AudienceTarget): Record<string, unknown> {
    if (audience.externalUserIds?.length) {
      return { external_user_ids: audience.externalUserIds };
    }
    if (audience.segmentId) {
      return { segment_id: audience.segmentId, broadcast: true };
    }
    return {};
  }
}
