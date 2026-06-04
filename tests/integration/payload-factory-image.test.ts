import { describe, it, expect } from "bun:test";
import { PayloadFactory } from "@/lib/braze/payload-factory";

const factory = new PayloadFactory();
const aud = { externalUserIds: ["u1"] };

function pushOf(payload: Record<string, unknown>) {
  const messages = payload.messages as Record<string, Record<string, unknown>>;
  return { android: messages.android_push, apple: messages.apple_push };
}

describe("payload-factory image fields", () => {
  it("sets per-platform image URLs (iOS asset_url + asset_file_type, Android image_url)", () => {
    const p = factory.buildPushPayload(
      {
        title: "t", body: "b",
        iosImageUrl: "https://x/y/77058/1280x1280.jpg",
        androidImageUrl: "https://x/y/1024.png",
      },
      aud,
    );
    const { android, apple } = pushOf(p);
    expect(apple.asset_url).toBe("https://x/y/77058/1280x1280.jpg");
    expect(apple.asset_file_type).toBe("jpg");
    expect(apple.rich_notification).toBeUndefined();
    expect(android.image_url).toBe("https://x/y/1024.png");
  });

  it("falls back to iconImageUrl for both platforms when per-platform URLs absent", () => {
    const p = factory.buildPushPayload(
      { title: "t", body: "b", iconImageUrl: "https://x/y/a.png" },
      aud,
    );
    const { android, apple } = pushOf(p);
    expect(apple.asset_url).toBe("https://x/y/a.png");
    expect(apple.asset_file_type).toBe("png");
    expect(android.image_url).toBe("https://x/y/a.png");
  });

  it("omits image fields entirely when no image is supplied", () => {
    const p = factory.buildPushPayload({ title: "t", body: "b" }, aud);
    const { android, apple } = pushOf(p);
    expect(apple.asset_url).toBeUndefined();
    expect(apple.asset_file_type).toBeUndefined();
    expect(android.image_url).toBeUndefined();
  });
});
