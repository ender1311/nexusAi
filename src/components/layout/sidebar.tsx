"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronDown, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import {
  navTree, isGroup, activeHref, groupLabelForHref,
  mobileTabs, mobileTabLabel, activeMobileTabLabel, isDivider,
  type NavItem, type NavGroup,
} from "@/components/layout/nav-config";

type SidebarUser = { email: string; firstName: string | null; lastName: string | null };

const EXPANDED_KEY = "nexus.nav.expanded";
const EXPANDED_EVENT = "nexus:nav-expanded-change";

// Read persisted group state via useSyncExternalStore so it's hydration-safe
// (server renders the empty snapshot, client swaps to localStorage after) and
// avoids setState-in-effect. getSnapshot returns the raw string so the
// reference stays stable across renders; parsing happens in a memo.
function subscribeExpanded(callback: () => void): () => void {
  window.addEventListener(EXPANDED_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EXPANDED_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
function getExpandedSnapshot(): string {
  return localStorage.getItem(EXPANDED_KEY) ?? "{}";
}
function getExpandedServerSnapshot(): string {
  return "{}";
}

export function Sidebar({ user }: { user: SidebarUser | null }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const active = activeHref(pathname, navTree);
  const activeGroup = groupLabelForHref(active, navTree);

  const rawExpanded = useSyncExternalStore(subscribeExpanded, getExpandedSnapshot, getExpandedServerSnapshot);
  const expanded = useMemo<Record<string, boolean>>(() => {
    try {
      return JSON.parse(rawExpanded);
    } catch {
      return {};
    }
  }, [rawExpanded]);

  // A group is open if explicitly toggled open, otherwise it defaults to open
  // when it contains the active route.
  function isExpanded(label: string): boolean {
    if (label in expanded) return expanded[label];
    return label === activeGroup;
  }

  function toggleGroup(label: string) {
    const next = { ...expanded, [label]: !isExpanded(label) };
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(EXPANDED_EVENT));
    } catch {
      /* ignore */
    }
  }

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email
    : null;
  const initials = user ? (user.firstName?.[0] ?? user.email[0]).toUpperCase() : "?";

  function renderLink(item: NavItem, nested: boolean) {
    const isActive = item.href === active;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={collapsed ? item.label : undefined}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
          nested && !collapsed && "ml-4",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  }

  function renderGroup(group: NavGroup) {
    const open = isExpanded(group.label);
    const hasActive = group.label === activeGroup;
    if (collapsed) {
      // Rail mode: a single icon that navigates to the group's first child.
      const first = group.children[0];
      return (
        <Link
          key={group.label}
          href={first.href}
          title={group.label}
          aria-current={hasActive ? "page" : undefined}
          className={cn(
            "flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            hasActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <group.icon className="h-4 w-4 shrink-0" />
        </Link>
      );
    }
    return (
      <div key={group.label}>
        <button
          type="button"
          onClick={() => toggleGroup(group.label)}
          aria-expanded={open}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
            hasActive && !open
              ? "text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <group.icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{group.label}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")} />
        </button>
        {open && <div className="mt-1 space-y-1">{group.children.map((c) => renderLink(c, true))}</div>}
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col border-r bg-sidebar transition-all duration-300 shrink-0",
        collapsed ? "w-16" : "w-60",
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
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {navTree.map((entry) => (isGroup(entry) ? renderGroup(entry) : renderLink(entry, false)))}
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
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
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

export function MobileNav() {
  const pathname = usePathname();
  const [openTab, setOpenTab] = useState<string | null>(null);
  const active = activeHref(pathname, navTree);
  const activeTab = activeMobileTabLabel(pathname);

  // Route change closes any open fan so it never lingers after navigation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenTab(null);
  }, [pathname]);

  return (
    <>
      {openTab && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden="true"
          onClick={() => setOpenTab(null)}
        />
      )}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex lg:hidden border-t bg-sidebar pb-[env(safe-area-inset-bottom)]">
        {mobileTabs.map((tab) => {
          const label = mobileTabLabel(tab);
          const isActive = label === activeTab;

          if (tab.kind === "link") {
            return (
              <Link
                key={label}
                href={tab.item.href}
                onClick={() => setOpenTab(null)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <tab.item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                <span>{label}</span>
              </Link>
            );
          }

          const open = openTab === label;
          return (
            <div key={label} className="relative flex flex-1">
              {open && (
                <div className="absolute bottom-full left-1/2 z-50 mb-2 flex min-w-[10rem] -translate-x-1/2 flex-col gap-1 rounded-lg border bg-sidebar p-1 shadow-lg">
                  {tab.children.map((child, i) =>
                    isDivider(child) ? (
                      <hr key={`divider-${i}`} className="my-1 border-t" />
                    ) : (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={() => setOpenTab(null)}
                        className={cn(
                          "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          child.href === active
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <child.icon className="h-4 w-4 shrink-0" />
                        <span>{child.label}</span>
                      </Link>
                    ),
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setOpenTab(open ? null : label)}
                aria-expanded={open}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <tab.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                <span>{label}</span>
              </button>
            </div>
          );
        })}
      </nav>
    </>
  );
}
