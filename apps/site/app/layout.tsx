import type { Metadata } from "next";
import { allBrandsCss } from "@site/brand/css";
import { fontVariables } from "@site/brand/fonts";
import { activeBrand } from "@site/brand/presets";
import "./globals.css";

const brand = activeBrand();

export const metadata: Metadata = {
  metadataBase: new URL("https://beaconfrontier.com"),
  alternates: { canonical: "/nexus" },
  title: brand.identity.ogTitle,
  description:
    "Nexus picks the right message, channel and time for each user, then learns from every send. Live today with Braze and Hightouch; more connectors on the roadmap.",
  openGraph: { title: brand.identity.ogTitle, siteName: brand.identity.name },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-brand={brand.id} className={fontVariables}>
      <head>
        {/* Brand tokens for every preset (the CSP allows inline styles). Values are validated, see brand/validate.ts. */}
        <style dangerouslySetInnerHTML={{ __html: allBrandsCss() }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
