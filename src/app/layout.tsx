import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
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
  // withAuth with ensureSignedIn: true redirects to WorkOS AuthKit if the
  // visitor has no session. All page routes are protected; API routes are
  // exempt via the middleware unauthenticatedPaths config.
  const { user } = await withAuth({ ensureSignedIn: true });

  const sidebarUser = {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  };

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="flex h-screen overflow-hidden bg-background">
          <Sidebar user={sidebarUser} />
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
