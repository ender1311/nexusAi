import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar, MobileNav } from "@/components/layout/sidebar";
import { DataModeProvider } from "@/components/layout/data-mode-provider";
import { RoutePreloader } from "@/components/layout/route-preloader";
import { ThemeProvider } from "next-themes";
import { withAuth } from "@workos-inc/authkit-nextjs";
import NextTopLoader from "nextjs-toploader";
import { Toaster } from "sonner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#ff3d4d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Nexus",
  description: "YouVersion AI-powered personalized messaging decisions",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Nexus",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user } = await withAuth();

  const sidebarUser = user
    ? {
        email: user.email,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
      }
    : null;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}>
        <NextTopLoader color="var(--primary)" showSpinner={false} height={2} />
        <Toaster richColors position="top-center" />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {user ? (
            <DataModeProvider>
              <RoutePreloader />
              <div className="flex h-full overflow-hidden bg-background">
                <Sidebar user={sidebarUser} />
                <main className="flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
                  {children}
                </main>
              </div>
              <MobileNav />
            </DataModeProvider>
          ) : (
            <>{children}</>
          )}
        </ThemeProvider>
      </body>
    </html>
  );
}
