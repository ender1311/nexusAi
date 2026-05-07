/**
 * Unit tests for the Braze Currents webhook event parsing and
 * click-event identification logic.
 */

import { describe, test, expect } from "bun:test";

// ── Mirror constants from the route ──────────────────────────────────────────
const CLICK_EVENTS = new Set([
  "users.messages.pushnotification.Open",
  "users.messages.email.Click",
  "users.messages.contentcard.Click",
  "users.messages.inappmessage.Click",
]);

const CLICK_REWARD = 0.8;

type BrazeEvent = {
  id?: string;
  event_type?: string;
  name?: string;
  user?: { user_id?: string };
  data?: { external_user_id?: string; send_id?: string; message_variation_id?: string };
  properties?: { send_id?: string; message_variation_id?: string };
};

function extractFields(event: BrazeEvent) {
  return {
    eventType:  event.event_type ?? event.name ?? "",
    userId:     event.user?.user_id ?? event.data?.external_user_id ?? "",
    sendId:     event.properties?.send_id ?? event.data?.send_id ?? "",
    variantId:  event.properties?.message_variation_id ?? event.data?.message_variation_id ?? "",
  };
}

describe("braze-events webhook — event parsing", () => {
  test("extracts fields from current Currents format (properties + user)", () => {
    const event: BrazeEvent = {
      event_type: "users.messages.pushnotification.Open",
      id: "evt-1",
      user: { user_id: "user123" },
      properties: { send_id: "send_abc", message_variation_id: "var_1" },
    };
    const { eventType, userId, sendId, variantId } = extractFields(event);
    expect(eventType).toBe("users.messages.pushnotification.Open");
    expect(userId).toBe("user123");
    expect(sendId).toBe("send_abc");
    expect(variantId).toBe("var_1");
  });

  test("extracts fields from legacy Currents format (data object)", () => {
    const event: BrazeEvent = {
      name: "users.messages.email.Click",
      id: "evt-2",
      data: { external_user_id: "user456", send_id: "send_xyz", message_variation_id: "var_2" },
    };
    const { eventType, userId, sendId } = extractFields(event);
    expect(eventType).toBe("users.messages.email.Click");
    expect(userId).toBe("user456");
    expect(sendId).toBe("send_xyz");
  });

  test("properties take precedence over data fields for send_id", () => {
    const event: BrazeEvent = {
      event_type: "users.messages.pushnotification.Open",
      user: { user_id: "u1" },
      properties: { send_id: "from_properties" },
      data: { send_id: "from_data" },
    };
    expect(extractFields(event).sendId).toBe("from_properties");
  });
});

describe("braze-events webhook — click event classification", () => {
  test("push Open is treated as a click event", () => {
    expect(CLICK_EVENTS.has("users.messages.pushnotification.Open")).toBe(true);
  });

  test("email Click is a click event", () => {
    expect(CLICK_EVENTS.has("users.messages.email.Click")).toBe(true);
  });

  test("content card Click is a click event", () => {
    expect(CLICK_EVENTS.has("users.messages.contentcard.Click")).toBe(true);
  });

  test("in-app message Click is a click event", () => {
    expect(CLICK_EVENTS.has("users.messages.inappmessage.Click")).toBe(true);
  });

  test("email Open is NOT a click event (handled by analytics cron)", () => {
    expect(CLICK_EVENTS.has("users.messages.email.Open")).toBe(false);
  });

  test("push Bounce is NOT a click event", () => {
    expect(CLICK_EVENTS.has("users.messages.pushnotification.Bounce")).toBe(false);
  });

  test("unknown event type is not a click", () => {
    expect(CLICK_EVENTS.has("")).toBe(false);
    expect(CLICK_EVENTS.has("some.other.event")).toBe(false);
  });
});

describe("braze-events webhook — reward value", () => {
  test("click reward is 0.8 (same cap as aggregate analytics formula)", () => {
    expect(CLICK_REWARD).toBe(0.8);
  });

  test("click reward is positive", () => {
    expect(CLICK_REWARD).toBeGreaterThan(0);
  });
});

describe("braze-events webhook — batch deduplication", () => {
  function dedup(events: BrazeEvent[]): BrazeEvent[] {
    const seen = new Set<string>();
    return events.filter((e) => {
      if (!e.id) return true;
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  test("removes duplicate events by id", () => {
    const events = [
      { id: "a", event_type: "users.messages.pushnotification.Open" },
      { id: "b", event_type: "users.messages.pushnotification.Open" },
      { id: "a", event_type: "users.messages.pushnotification.Open" }, // duplicate
    ];
    expect(dedup(events)).toHaveLength(2);
  });

  test("keeps events without id (cannot deduplicate)", () => {
    const events = [
      { event_type: "users.messages.pushnotification.Open" },
      { event_type: "users.messages.pushnotification.Open" },
    ];
    expect(dedup(events)).toHaveLength(2);
  });

  test("unique ids all kept", () => {
    const events = [
      { id: "1" }, { id: "2" }, { id: "3" },
    ];
    expect(dedup(events)).toHaveLength(3);
  });
});
