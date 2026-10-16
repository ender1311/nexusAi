import type { ContentChannel } from "@/lib/content-core";

/** Content-core channel → the `Message.channel` name Nexus' libraries, cron and Braze payloads use. */
export const NEXUS_CHANNEL_FOR: Readonly<Record<ContentChannel, string>> = {
  push: "push",
  email: "email",
  content_card: "content-card",
  slideup: "in-app",
  modal: "modal-iam",
};
