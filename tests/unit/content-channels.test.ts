import { describe, expect, it } from "bun:test";
import { NEXUS_CHANNEL_FOR } from "@/connectors/content/channels";
import { CONTENT_CHANNELS } from "@/lib/content-core";

describe("NEXUS_CHANNEL_FOR", () => {
  it("maps every content-core channel to the Nexus Message.channel name", () => {
    expect(NEXUS_CHANNEL_FOR).toEqual({
      push: "push", email: "email", content_card: "content-card", slideup: "in-app", modal: "modal-iam",
    });
    expect(Object.keys(NEXUS_CHANNEL_FOR).sort()).toEqual([...CONTENT_CHANNELS].sort());
  });
});
