export const config = {
  calendlyUrl: process.env.NEXT_PUBLIC_CALENDLY_URL ?? "https://calendly.com/danluk1311/30min",
  leadNotifyEmail: process.env.LEAD_NOTIFY_EMAIL ?? "danluk1311@gmail.com",
  leadIpSalt: process.env.LEAD_IP_SALT ?? "nexus-dev-salt",
  leadFromEmail: "Nexus <nexus@beaconfrontier.com>",
  consoleUrl: "https://nexus-ai-demo-dl.vercel.app",
};
