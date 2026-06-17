import type { CSSProperties } from "react";
import { Network } from "lucide-react";
import { cn } from "@/lib/utils";

type NexusMarkSvgProps = {
  size?: number;
  stroke?: string;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
};

/** Lucide Network paths — shared by favicon / apple-icon OG renders. */
export function NexusMarkSvg({
  size = 24,
  stroke = "currentColor",
  strokeWidth = 2,
  className,
  style,
}: NexusMarkSvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </svg>
  );
}

export function NexusMark({ className }: { className?: string }) {
  return <Network className={cn("text-primary", className)} aria-hidden />;
}
