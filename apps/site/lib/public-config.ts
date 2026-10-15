/** Values safe to ship to the browser. Server-only settings live in config.ts. */
export const publicConfig = {
  calendlyUrl: process.env.NEXT_PUBLIC_CALENDLY_URL ?? "https://calendly.com/danluk1311/30min",
  consoleUrl: "https://nexus-ai-demo-dl.vercel.app",
  /** The demo console link stays hidden until the demo deployment is ready to show. */
  showConsoleLink: false,
};
