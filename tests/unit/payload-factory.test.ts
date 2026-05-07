import { describe, expect, it } from "bun:test";
import { PayloadFactory } from "@/lib/braze/payload-factory";

describe("PayloadFactory.buildPushPayload", () => {
  const factory = new PayloadFactory({
    androidAppId: "test-android-app-id",
    iosAppId: "test-ios-app-id",
  });

  const audience = { externalUserIds: ["user-1", "user-2"] };

  it("places title in android title and apple alert.title", () => {
    const payload = factory.buildPushPayload(
      { title: "Want peace?", body: "Open your Bible today." },
      audience,
    );
    const messages = payload.messages as Record<string, Record<string, unknown>>;
    expect(messages.android_push.title).toBe("Want peace?");
    expect((messages.apple_push.alert as Record<string, unknown>).title).toBe("Want peace?");
  });

  it("places body in android alert and apple alert.body", () => {
    const payload = factory.buildPushPayload(
      { title: "Title", body: "Read a verse." },
      audience,
    );
    const messages = payload.messages as Record<string, Record<string, unknown>>;
    expect(messages.android_push.alert).toBe("Read a verse.");
    expect((messages.apple_push.alert as Record<string, unknown>).body).toBe("Read a verse.");
  });

  it("places deeplink in custom_uri for both platforms", () => {
    const payload = factory.buildPushPayload(
      { title: "T", body: "B", deeplink: "bible://verse/John.3.16" },
      audience,
    );
    const messages = payload.messages as Record<string, Record<string, unknown>>;
    expect(messages.android_push.custom_uri).toBe("bible://verse/John.3.16");
    expect(messages.apple_push.custom_uri).toBe("bible://verse/John.3.16");
  });

  it("omits custom_uri when deeplink is not provided", () => {
    const payload = factory.buildPushPayload({ title: "T", body: "B" }, audience);
    const messages = payload.messages as Record<string, Record<string, unknown>>;
    expect(messages.android_push.custom_uri).toBeUndefined();
    expect(messages.apple_push.custom_uri).toBeUndefined();
  });

  it("sets external_user_ids from audience", () => {
    const payload = factory.buildPushPayload({ title: "T", body: "B" }, audience);
    expect(payload.external_user_ids).toEqual(["user-1", "user-2"]);
  });

  it("includes campaign_id and send_id when provided", () => {
    const payload = factory.buildPushPayload(
      { title: "T", body: "B" },
      audience,
      "campaign-abc",
      "send-xyz",
    );
    expect(payload.campaign_id).toBe("campaign-abc");
    expect(payload.send_id).toBe("send-xyz");
  });

  it("omits campaign_id and send_id when not provided", () => {
    const payload = factory.buildPushPayload({ title: "T", body: "B" }, audience);
    expect(payload.campaign_id).toBeUndefined();
    expect(payload.send_id).toBeUndefined();
  });

  it("sets in_local_time when inLocalTime is true", () => {
    const payload = factory.buildPushPayload(
      { title: "T", body: "B" },
      audience,
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(payload.in_local_time).toBe(true);
  });

  it("omits in_local_time when not set", () => {
    const payload = factory.buildPushPayload({ title: "T", body: "B" }, audience);
    expect(payload.in_local_time).toBeUndefined();
  });

  it("attaches android and ios app_id when using externalUserIds audience", () => {
    const payload = factory.buildPushPayload({ title: "T", body: "B" }, audience);
    const messages = payload.messages as Record<string, Record<string, unknown>>;
    expect(messages.android_push.app_id).toBe("test-android-app-id");
    expect(messages.apple_push.app_id).toBe("test-ios-app-id");
  });

  it("live send: title is the raw DB value with no [TEST] prefix and no Liquid injection", () => {
    // Live cron passes group.title directly — no personalization wrapping
    const rawDbTitle = "Don't forget to read today";
    const payload = factory.buildPushPayload({ title: rawDbTitle, body: "B" }, audience);
    const messages = payload.messages as Record<string, Record<string, unknown>>;
    expect(messages.android_push.title).toBe(rawDbTitle);
    expect((messages.apple_push.alert as Record<string, unknown>).title).toBe(rawDbTitle);
    // Explicitly assert no [TEST] prefix and no Liquid tokens
    expect(String(messages.android_push.title)).not.toContain("[TEST]");
    expect(String(messages.android_push.title)).not.toContain("{{");
  });
});
