// Regression: getCachedPreferredChannelStats aggregates how many tracked users
// prefer each channel, read from the TrackedUser.attributes JSON. Locks the exact
// JSON keys + SQL column aliases so a rename in the query (or a drift between the
// keys Hightouch sends and the keys the dashboard/wizard read) can't silently zero
// out the channel-preference visibility.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/builders";
import { getCachedPreferredChannelStats } from "@/lib/cache/dashboard";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("getCachedPreferredChannelStats", () => {
  it("counts external (push-vs-email) and overall 90-day channel preferences", async () => {
    // external_90: 2 push, 1 email. overall_90: 1 push, 1 email, 1 in_app, 1 content_card.
    await createUser("u_ext_push_1", {
      attributes: {
        preferred_channel_external_90_days: "push_notification",
        preferred_channel_overall_90_days: "push_notification",
      },
    });
    await createUser("u_ext_push_2", {
      attributes: {
        preferred_channel_external_90_days: "push_notification",
        preferred_channel_overall_90_days: "in_app_message",
      },
    });
    await createUser("u_ext_email_1", {
      attributes: {
        preferred_channel_external_90_days: "email",
        preferred_channel_overall_90_days: "email",
      },
    });
    await createUser("u_overall_cc", {
      attributes: {
        preferred_channel_overall_90_days: "content_card",
      },
    });
    // A user with no preferred_channel data must not inflate any bucket.
    await createUser("u_no_data", {});

    const stats = await getCachedPreferredChannelStats();

    expect(stats.total).toBe(5);
    expect(stats.external.push_notification).toBe(2);
    expect(stats.external.email).toBe(1);
    expect(stats.overall.push_notification).toBe(1);
    expect(stats.overall.email).toBe(1);
    expect(stats.overall.in_app_message).toBe(1);
    expect(stats.overall.content_card).toBe(1);
  });
});
