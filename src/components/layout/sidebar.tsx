"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Bot,
  MessageSquare,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  Users2,
  PlayCircle,
  Radar,
  Sprout,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { useDataMode } from "@/components/layout/data-mode-provider";

type SidebarUser = {
  email: string;
  firstName: string | null;
  lastName: string | null;
};

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/personas", label: "Personas", icon: Users2 },
  { href: "/performance", label: "Performance", icon: BarChart3 },
  { href: "/control-tower", label: "Control Tower", icon: Radar },
  { href: "/demo", label: "Demo", icon: PlayCircle },
  { href: "/about", label: "About", icon: Sprout },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ user }: { user: SidebarUser | null }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { mode, setMode } = useDataMode();

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
    : null;
  const initials = user
    ? (user.firstName?.[0] ?? user.email[0]).toUpperCase()
    : "?";

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-sidebar transition-all duration-300 shrink-0",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className="flex items-center justify-between h-16 px-4 border-b">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm">Nexus</span>
          </div>
        )}
        {collapsed && <Zap className="h-5 w-5 text-primary mx-auto" />}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="p-1 rounded-md hover:bg-muted text-muted-foreground ml-auto"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Demo / Live toggle */}
      <div className="border-t px-3 py-2.5">
        {collapsed ? (
          <button
            onClick={() => setMode(mode === "demo" ? "live" : "demo")}
            aria-label={
              mode === "demo"
                ? "Data source: Demo — click to switch to Live"
                : "Data source: Live — click to switch to Demo"
            }
            title={
              mode === "demo"
                ? "Demo mode — click for live"
                : "Live mode — click for demo"
            }
            className={cn(
              "flex h-7 w-7 mx-auto items-center justify-center rounded-full text-xs font-bold transition-colors",
              mode === "demo"
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
            )}
          >
            {mode === "demo" ? "D" : "L"}
          </button>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Data source</span>
            <div className="flex items-center gap-0.5 rounded-md border p-0.5">
              <button
                onClick={() => setMode("demo")}
                aria-label="Switch to Demo data source"
                aria-pressed={mode === "demo"}
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  mode === "demo"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Demo
              </button>
              <button
                onClick={() => setMode("live")}
                aria-label="Switch to Live data source"
                aria-pressed={mode === "live"}
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                  mode === "live"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Live
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border-t p-2">
        {!collapsed && user && (
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
        )}
        {collapsed && user && (
          <div className="flex justify-center py-2 mb-1">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              {initials}
            </div>
          </div>
        )}
        <SignOutButton collapsed={collapsed} />
      </div>
    </aside>
  );
}
