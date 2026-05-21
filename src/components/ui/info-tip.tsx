"use client";

import { Popover } from "@base-ui/react/popover";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface InfoTipProps {
  title: string;
  children: React.ReactNode;
  /** Side the popup opens on — defaults to "bottom" */
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

/**
 * Click-triggered info popover. Renders a small HelpCircle icon; clicking it
 * opens a positioned popup with a title and explanation text.
 *
 * Usage: <InfoTip title="Frequency Cap">Explanation here…</InfoTip>
 */
export function InfoTip({ title, children, side = "bottom", className }: InfoTipProps) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Learn about ${title}`}
        className={cn(
          "inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors",
          className,
        )}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side={side} align="start" sideOffset={6}>
          <Popover.Popup className="z-50 w-72 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Popover.Title className="text-sm font-semibold mb-2">{title}</Popover.Title>
            <div className="text-xs text-muted-foreground leading-relaxed space-y-1.5">
              {children}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
