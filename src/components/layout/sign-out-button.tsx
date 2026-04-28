"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { handleSignOut } from "@/app/actions/auth";

export function SignOutButton({ collapsed }: { collapsed: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => { void handleSignOut(); })}
      disabled={pending}
      className={cn(
        "flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
        "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50",
        collapsed && "justify-center"
      )}
    >
      <LogOut className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{pending ? "Signing out…" : "Sign out"}</span>}
    </button>
  );
}
