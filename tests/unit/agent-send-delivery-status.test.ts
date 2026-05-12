import { describe, it, expect } from "bun:test";
import { getAgentSendDeliveryStatus } from "@/lib/agent-send-delivery-status";

describe("getAgentSendDeliveryStatus", () => {
  const t0 = Date.parse("2026-05-11T12:00:00.000Z");

  it("returns failed when row.failed regardless of schedule", () => {
    expect(
      getAgentSendDeliveryStatus(
        { failed: true, scheduledFor: "2026-05-12T08:00:00.000Z" },
        t0,
      ),
    ).toBe("failed");
  });

  it("returns pending when not failed and scheduledFor is in the future", () => {
    expect(
      getAgentSendDeliveryStatus(
        { failed: false, scheduledFor: "2026-05-12T08:00:00.000Z" },
        t0,
      ),
    ).toBe("pending");
  });

  it("returns delivered when not failed and scheduledFor is null", () => {
    expect(getAgentSendDeliveryStatus({ failed: false, scheduledFor: null }, t0)).toBe("delivered");
  });

  it("returns delivered when not failed and scheduledFor is in the past", () => {
    expect(
      getAgentSendDeliveryStatus(
        { failed: false, scheduledFor: "2026-05-10T08:00:00.000Z" },
        t0,
      ),
    ).toBe("delivered");
  });

  it("returns delivered when scheduledFor equals now (edge)", () => {
    expect(
      getAgentSendDeliveryStatus(
        { failed: false, scheduledFor: "2026-05-11T12:00:00.000Z" },
        t0,
      ),
    ).toBe("delivered");
  });
});
