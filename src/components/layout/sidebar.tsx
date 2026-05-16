"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Bot,
  BookOpen,
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
import { ThemeToggle } from "@/components/layout/theme-toggle";

type SidebarUser = {
  email: string;
  firstName: string | null;
  lastName: string | null;
};

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/messages", label: "Push Library", icon: BookOpen },
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

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
    : null;
  const initials = user
    ? (user.firstName?.[0] ?? user.email[0]).toUpperCase()
    : "?";

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col border-r bg-sidebar transition-all duration-300 shrink-0",
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

<div className="border-t px-3 py-2.5">
        <ThemeToggle collapsed={collapsed} />
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

const mobileNavItems = navItems
  .filter((item) =>
    ["/", "/agents", "/demo", "/control-tower", "/settings"].includes(item.href)
  )
  .map((item) => ({
    ...item,
    mobileLabel: item.href === "/control-tower" ? "Tower" : item.label,
  }));

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex lg:hidden border-t bg-sidebar pb-[env(safe-area-inset-bottom)]">
      {mobileNavItems.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <item.icon className={cn("h-5 w-5", active && "text-primary")} />
            <span>{item.mobileLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}
