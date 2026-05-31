import { describe, it, expect } from "bun:test";
import {
  LOCAL_TIME_DELIVERY_BUFFER_MS,
  effectiveDeliveryDeadlineMs,
  isPendingDelivery,
} from "@/lib/agent-sends/pending-deadline";

const ANCHOR = "2024-05-10T08:00:00.000Z";
const ANCHOR_MS = Date.parse(ANCHOR);

describe("effectiveDeliveryDeadlineMs", () => {
  it("returns the raw scheduled time when not in_local_time", () => {
    expect(effectiveDeliveryDeadlineMs(ANCHOR, false)).toBe(ANCHOR_MS);
    expect(effectiveDeliveryDeadlineMs(ANCHOR, undefined)).toBe(ANCHOR_MS);
  });

  it("adds the 12h buffer when in_local_time", () => {
    expect(effectiveDeliveryDeadlineMs(ANCHOR, true)).toBe(ANCHOR_MS + LOCAL_TIME_DELIVERY_BUFFER_MS);
  });

  it("buffer is exactly 12 hours", () => {
    expect(LOCAL_TIME_DELIVERY_BUFFER_MS).toBe(12 * 60 * 60 * 1000);
  });
});

describe("isPendingDelivery", () => {
  it("is false when there is no scheduledFor (immediate send)", () => {
    expect(isPendingDelivery({ scheduledFor: null, decisionContext: null }, ANCHOR_MS)).toBe(false);
  });

  it("is true when the anchor is in the future", () => {
    expect(isPendingDelivery({ scheduledFor: ANCHOR, decisionContext: null }, ANCHOR_MS - 1000)).toBe(true);
  });

  it("is false when the anchor has passed (non-local-time)", () => {
    expect(isPendingDelivery({ scheduledFor: ANCHOR, decisionContext: null }, ANCHOR_MS + 1000)).toBe(false);
  });

  it("stays pending within the 12h buffer for in_local_time sends", () => {
    // 6h past the anchor — still pending for far-west timezones.
    const sixHoursLater = ANCHOR_MS + 6 * 60 * 60 * 1000;
    expect(
      isPendingDelivery({ scheduledFor: ANCHOR, decisionContext: { inLocalTime: true } }, sixHoursLater),
    ).toBe(true);
  });

  it("becomes delivered once the 12h buffer elapses for in_local_time sends", () => {
    const thirteenHoursLater = ANCHOR_MS + 13 * 60 * 60 * 1000;
    expect(
      isPendingDelivery({ scheduledFor: ANCHOR, decisionContext: { inLocalTime: true } }, thirteenHoursLater),
    ).toBe(false);
  });

  it("without inLocalTime, a send 6h past the anchor is already delivered", () => {
    const sixHoursLater = ANCHOR_MS + 6 * 60 * 60 * 1000;
    expect(
      isPendingDelivery({ scheduledFor: ANCHOR, decisionContext: null }, sixHoursLater),
    ).toBe(false);
  });
});
