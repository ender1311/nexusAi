import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { DataModeProvider } from "@/components/layout/data-mode-provider";
import { withAuth } from "@workos-inc/authkit-nextjs";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

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
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <DataModeProvider>
          <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar user={sidebarUser} />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </DataModeProvider>
      </body>
    </html>
  );
}
