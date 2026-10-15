import { publicConfig } from "@site/lib/public-config";

export const config = {
  ...publicConfig,
  leadNotifyEmail: process.env.LEAD_NOTIFY_EMAIL ?? "danluk1311@gmail.com",
  leadIpSalt: process.env.LEAD_IP_SALT ?? "nexus-dev-salt",
  leadFromEmail: "Nexus <nexus@beaconfrontier.com>",
};
