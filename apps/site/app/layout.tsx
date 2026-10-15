import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus: AI decisioning for the stack you already have",
  description:
    "Nexus picks the right message, channel and time for each user, then learns from every send. Plugs into your CDP, warehouse and ESP.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
