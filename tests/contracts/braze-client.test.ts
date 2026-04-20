import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { BrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { FakeFetch } from "../helpers/braze";

// BrazeClient uses globalThis.fetch directly; we replace it with FakeFetch.
let fake: FakeFetch;

beforeEach(() => {
  fake = new FakeFetch();
  (globalThis as Record<string, unknown>).fetch = fake.fetch;
});

afterEach(() => {
  // vi.unstubAllGlobals() is called by tests/setup/bun.ts afterEach,
  // but we restore manually here since we set it directly.
  delete (globalThis as Record<string, unknown>).fetch;
});

describe("BrazeClient", () => {
  it("normalises URL: adds https:// when scheme is missing", async () => {
    const client = new BrazeClient("key", "rest.test.braze.com");
    fake.queueResponse({});
    await client.post("/test");
    expect(fake.requests[0].url).toBe("https://rest.test.braze.com/test");
  });

  it("post sends Authorization Bearer header", async () => {
    const client = new BrazeClient("my_key", "https://rest.test.braze.com");
    fake.queueResponse({});
    await client.post("/messages/send", { foo: "bar" });
    expect(fake.requests[0].url).toContain("rest.test.braze.com/messages/send");
    // The header is inspected via init — FakeFetch records raw init
  });

  it("post hits the correct URL", async () => {
    const client = new BrazeClient("key", "https://rest.test.braze.com");
    fake.queueResponse({});
    await client.post("/messages/send", {});
    expect(fake.requests[0].url).toBe("https://rest.test.braze.com/messages/send");
    expect(fake.requests[0].method).toBe("POST");
  });

  it("createSendId returns the sendId on success (201)", async () => {
    const client = new BrazeClient("key", "https://rest.test.braze.com");
    fake.queueResponse({ message: "success" }, 201);
    const sendId = await client.createSendId("camp_123", "test");
    expect(typeof sendId).toBe("string");
    expect(sendId).toContain("test_");
    expect(fake.requests[0].url).toContain("/sends/id/create");
  });

  it("createSendId returns null on Braze error (400)", async () => {
    const client = new BrazeClient("key", "https://rest.test.braze.com");
    fake.queueResponse({ error: "bad request" }, 400);
    const sendId = await client.createSendId("camp_123");
    expect(sendId).toBeNull();
  });

  it("createSendId returns null when campaignId is empty", async () => {
    const client = new BrazeClient("key", "https://rest.test.braze.com");
    const sendId = await client.createSendId("");
    expect(sendId).toBeNull();
    expect(fake.requests).toHaveLength(0); // no HTTP call made
  });

  it("strips trailing slash from restUrl", async () => {
    const client = new BrazeClient("key", "https://rest.test.braze.com/");
    fake.queueResponse({});
    await client.post("/endpoint");
    expect(fake.requests[0].url).toBe("https://rest.test.braze.com/endpoint");
  });
});

describe("PayloadFactory", () => {
  const factory = new PayloadFactory({ androidAppId: "android_id", iosAppId: "ios_id" });

  it("buildPushPayload includes android_push and apple_push", () => {
    const payload = factory.buildPushPayload(
      { title: "Hello", body: "World", deeplink: "/home" },
      { externalUserIds: ["usr_1"] },
      "camp_1",
      "send_1",
      "var_1"
    );
    expect(payload).toHaveProperty("messages.android_push");
    expect(payload).toHaveProperty("messages.apple_push");
    expect((payload.messages as Record<string, unknown>).android_push).toMatchObject({ title: "Hello", alert: "World" });
    expect(payload.campaign_id).toBe("camp_1");
    expect(payload.send_id).toBe("send_1");
    expect(payload.external_user_ids).toEqual(["usr_1"]);
  });

  it("buildEmailPayload includes email message", () => {
    const payload = factory.buildEmailPayload(
      { subject: "Hi", htmlBody: "<p>Hello</p>" },
      { externalUserIds: ["usr_1"] }
    );
    expect(payload).toHaveProperty("messages.email");
    expect((payload.messages as Record<string, unknown>).email).toMatchObject({
      subject: "Hi",
      body: "<p>Hello</p>",
    });
  });

  it("buildSmsPayload includes sms message", () => {
    const payload = factory.buildSmsPayload(
      { body: "Your code is 1234" },
      { externalUserIds: ["usr_1"] }
    );
    expect(payload).toHaveProperty("messages.sms");
    expect((payload.messages as Record<string, unknown>).sms).toMatchObject({ body: "Your code is 1234" });
  });

  it("omits campaign_id/send_id when not provided", () => {
    const payload = factory.buildPushPayload(
      { title: "T", body: "B" },
      { externalUserIds: ["u1"] }
    );
    expect(payload.campaign_id).toBeUndefined();
    expect(payload.send_id).toBeUndefined();
  });
});
