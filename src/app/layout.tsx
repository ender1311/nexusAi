import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar, MobileNav } from "@/components/layout/sidebar";
import { DataModeProvider } from "@/components/layout/data-mode-provider";
import { ThemeProvider } from "next-themes";
import { withAuth } from "@workos-inc/authkit-nextjs";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nexus",
  description: "YouVersion AI-powered personalized messaging decisions",
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
      <body className={`${geistMono.variable} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {user ? (
            <DataModeProvider>
              <div className="flex h-screen overflow-hidden bg-background">
                <Sidebar user={sidebarUser} />
                <main className="flex-1 overflow-y-auto pb-16 lg:pb-0">
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
