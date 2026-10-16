import type { Metadata } from "next";
import { activeFontVariables } from "@site/brand/active-fonts.generated";
import { brandCss } from "@site/brand/css";
import { activeBrand } from "@site/brand/presets";
import "./globals.css";

const brand = activeBrand();

export const metadata: Metadata = {
  metadataBase: new URL("https://beaconfrontier.com"),
  alternates: { canonical: "/nexus" },
  title: brand.identity.ogTitle,
  description: brand.identity.ogDescription,
  openGraph: { title: brand.identity.ogTitle, description: brand.identity.ogDescription, siteName: brand.identity.name },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-brand={brand.id} className={activeFontVariables || undefined}>
      <head>
        {/* The active brand's tokens (the CSP allows inline styles). Values are validated, see brand/validate.ts. */}
        <style dangerouslySetInnerHTML={{ __html: brandCss(brand, `[data-brand="${brand.id}"]`) }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
