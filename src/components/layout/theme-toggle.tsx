"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const MODES = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark",  icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
] as const;

export function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // Avoid hydration mismatch: next-themes resolves theme client-side only.
  // Render nothing until mounted so SSR output matches initial client render.
  if (!mounted) return null;

  if (collapsed) {
    const currentIndex = MODES.findIndex((m) => m.value === theme);
    const current = MODES[currentIndex] ?? MODES[2]; // default to system
    const next = MODES[(currentIndex + 1) % MODES.length];
    return (
      <button
        onClick={() => setTheme(next.value)}
        title={`Theme: ${current.label} — click to switch to ${next.label}`}
        aria-label={`Theme: ${current.label}. Click to switch to ${next.label}`}
        className="flex h-7 w-7 mx-auto items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <current.icon className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">Theme</span>
      <div className="flex items-center gap-0.5 rounded-md border p-0.5">
        {MODES.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            aria-label={`Switch to ${label} theme`}
            aria-pressed={theme === value}
            title={label}
            className={cn(
              "rounded p-1 transition-colors",
              theme === value
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
