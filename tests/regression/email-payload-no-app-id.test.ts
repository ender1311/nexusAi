import { describe, expect, it } from "bun:test";
import { PayloadFactory } from "@/lib/braze/payload-factory";

// Regression: buildEmailPayload was unconditionally including `app_id: this.iosAppId`
// in the email message object. Email is channel-agnostic — it has no platform-specific
// app association — so app_id is wrong for email (and absent in the SMS payload).
// If iosAppId env var is set, this caused the iOS app_id to be sent to Braze for email
// sends, corrupting attribution and potentially triggering Braze validation errors.
describe("buildEmailPayload — no app_id bug", () => {
  it("does not include app_id in the email message object", () => {
    const factory = new PayloadFactory({
      iosAppId: "ios-app-123",
      androidAppId: "android-app-456",
    });

    const payload = factory.buildEmailPayload(
      {
        subject: "Test subject",
        htmlBody: "<p>Hello</p>",
      },
      { externalUserIds: ["user-1"] },
    );

    const emailMsg = (payload.messages as Record<string, unknown>).email as Record<string, unknown>;
    expect(emailMsg.app_id).toBeUndefined();
  });

  it("email payload still includes required fields", () => {
    const factory = new PayloadFactory({ iosAppId: "ios-app-123" });

    const payload = factory.buildEmailPayload(
      { subject: "Hi", htmlBody: "<p>Body</p>" },
      { externalUserIds: ["user-1"] },
      "campaign-abc",
      "variant-xyz",
    );

    const emailMsg = (payload.messages as Record<string, unknown>).email as Record<string, unknown>;
    expect(emailMsg.subject).toBe("Hi");
    expect(emailMsg.body).toBe("<p>Body</p>");
    expect(emailMsg.message_variation_id).toBe("variant-xyz");
    expect(payload.campaign_id).toBe("campaign-abc");
    expect(payload.external_user_ids).toEqual(["user-1"]);
  });
});
