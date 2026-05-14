"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, BookOpen } from "lucide-react";

const CHAPTERS = [
  { slug: "", label: "Overview", sub: "What this section covers" },
  { slug: "feature-vectors", label: "1. Feature Vectors", sub: "44-dim user representation" },
  { slug: "persona-clustering", label: "2. Persona Clustering", sub: "k-means + cosine similarity" },
  { slug: "bandit-algorithms", label: "3. Bandit Algorithms", sub: "Thompson Sampling, LinUCB, ε-greedy" },
  { slug: "reward-calculus", label: "4. Reward Calculus", sub: "Tiers, decay, attribution" },
  { slug: "lift-measurement", label: "5. Lift Measurement", sub: "Statistics & significance" },
  { slug: "send-time-optimization", label: "6. Send-Time Optimization", sub: "Behavioral timing + Braze" },
];

export default function DeepDiveLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Top bar */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/demo"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Demo
        </Link>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <BookOpen className="h-4 w-4 text-[#57a16c]" />
          Advanced Data Science
        </div>
      </div>

      <div className="flex gap-8 items-start">
        {/* Sidebar */}
        <nav className="hidden md:block w-56 shrink-0 sticky top-8">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-3 px-2">
            Chapters
          </p>
          <ul className="space-y-0.5">
            {CHAPTERS.map(({ slug, label, sub }) => {
              const href = slug ? `/demo/deep-dive/${slug}` : "/demo/deep-dive";
              const active = slug
                ? pathname === href || pathname.startsWith(href + "/")
                : pathname === "/demo/deep-dive";
              return (
                <li key={slug}>
                  <Link
                    href={href}
                    className={`block rounded-md px-2 py-1.5 transition-colors ${
                      active
                        ? "bg-[#57a16c]/10 text-[#57a16c] font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    <div className="text-xs leading-snug">{label}</div>
                    <div className="text-[10px] opacity-70 leading-tight mt-0.5">{sub}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Mobile chapter picker */}
        <div className="md:hidden w-full mb-4">
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={pathname}
            onChange={(e) => { window.location.href = e.target.value; }}
          >
            {CHAPTERS.map(({ slug, label }) => {
              const href = slug ? `/demo/deep-dive/${slug}` : "/demo/deep-dive";
              return <option key={slug} value={href}>{label}</option>;
            })}
          </select>
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
