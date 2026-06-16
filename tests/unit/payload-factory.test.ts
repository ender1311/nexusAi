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

  it("adds utm_campaign=nexus and utm_source=push to a web deeplink on both platforms", () => {
    const payload = factory.buildPushPayload(
      { title: "T", body: "B", deeplink: "https://www.bible.com/sowers" },
      audience,
    );
    const messages = payload.messages as Record<string, Record<string, unknown>>;
    const expected = "https://www.bible.com/sowers?utm_campaign=nexus&utm_source=push";
    expect(messages.android_push.custom_uri).toBe(expected);
    expect(messages.apple_push.custom_uri).toBe(expected);
  });

  it("leaves an app-scheme deeplink untagged (would corrupt verse ref)", () => {
    const payload = factory.buildPushPayload(
      { title: "T", body: "B", deeplink: "youversion://bible?reference=JHN.3.16" },
      audience,
    );
    const messages = payload.messages as Record<string, Record<string, unknown>>;
    expect(messages.android_push.custom_uri).toBe("youversion://bible?reference=JHN.3.16");
    expect(messages.apple_push.custom_uri).toBe("youversion://bible?reference=JHN.3.16");
  });

  it("sets external_user_ids from audience", () => {
    const payload = factory.buildPushPayload({ title: "T", body: "B" }, audience);
    expect(payload.external_user_ids).toEqual(["user-1", "user-2"]);
  });

  it("includes campaign_id when provided", () => {
    const payload = factory.buildPushPayload(
      { title: "T", body: "B" },
      audience,
      "campaign-abc",
    );
    expect(payload.campaign_id).toBe("campaign-abc");
    expect(payload.send_id).toBeUndefined();
  });

  it("omits campaign_id when not provided", () => {
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

  it("uses recipients array when audience.recipients is provided", () => {
    const recipients = [
      { external_user_id: "user-1" },
      { braze_id: "braze-abc" },
    ];
    const payload = factory.buildPushPayload({ title: "T", body: "B" }, { recipients });
    expect(payload.recipients).toEqual(recipients);
    expect(payload.external_user_ids).toBeUndefined();
  });

  it("recipients format still sets app_id in push messages", () => {
    const recipients = [{ external_user_id: "user-1" }];
    const payload = factory.buildPushPayload({ title: "T", body: "B" }, { recipients });
    const messages = payload.messages as Record<string, Record<string, unknown>>;
    expect(messages.android_push.app_id).toBe("test-android-app-id");
    expect(messages.apple_push.app_id).toBe("test-ios-app-id");
  });

  it("recipients takes precedence over externalUserIds when both are provided", () => {
    const recipients = [{ braze_id: "braze-xyz" }];
    const payload = factory.buildPushPayload(
      { title: "T", body: "B" },
      { externalUserIds: ["user-1"], recipients },
    );
    expect(payload.recipients).toEqual(recipients);
    expect(payload.external_user_ids).toBeUndefined();
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

describe("PayloadFactory.buildCanvasApiTriggerPayload", () => {
  const factory = new PayloadFactory();
  const audience = { externalUserIds: ["u1", "u2"] };

  it("slideup-only (null title) sets slideupOnly=true and omits title", () => {
    const p = factory.buildCanvasApiTriggerPayload(
      { title: null, message: "Slide body", link: null, imageUrl: null },
      audience,
      "canvas-slideup",
    );
    const props = p.canvas_entry_properties as Record<string, unknown>;
    expect(props.slideupOnly).toBe(true);
    expect(props.title).toBeUndefined();
    expect(props.message).toBe("Slide body");
    expect(p.canvas_id).toBe("canvas-slideup");
  });

  it("modal (title + cta) sets slideupOnly=false, includes title+cta, tags link utm_source=modal-iam", () => {
    const p = factory.buildCanvasApiTriggerPayload(
      {
        title: "You’re invited to join the Sowers Community!",
        message: "A gift of $25 a month will distribute over 600 Bible apps this year.",
        cta: "Give a Monthly Gift",
        link: "https://www.bible.com/sowers",
        imageUrl: null,
      },
      audience,
      "canvas-modal",
      "modal-iam",
    );
    const props = p.canvas_entry_properties as Record<string, unknown>;
    expect(props.slideupOnly).toBe(false);
    expect(props.title).toBe("You’re invited to join the Sowers Community!");
    expect(props.cta).toBe("Give a Monthly Gift");
    expect(p.canvas_id).toBe("canvas-modal");
    expect(props.link).toBe("https://www.bible.com/sowers?utm_campaign=nexus&utm_source=modal-iam");
  });

  it("defaults utm_source to in-app when not specified (slideup link)", () => {
    const p = factory.buildCanvasApiTriggerPayload(
      { title: null, message: "m", link: "https://www.bible.com/today", imageUrl: null },
      audience,
      "canvas-slideup",
    );
    const props = p.canvas_entry_properties as Record<string, unknown>;
    expect(props.link).toBe("https://www.bible.com/today?utm_campaign=nexus&utm_source=in-app");
  });
});
