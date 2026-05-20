"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyableIdProps {
  id: string;
  display?: string; // truncated display text; defaults to full id
  className?: string;
}

export function CopyableId({ id, display, className }: CopyableIdProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handleCopy}
      onKeyDown={(e) => e.key === "Enter" && handleCopy(e as unknown as React.MouseEvent)}
      title={`Copy ${id}`}
      className={cn(
        "inline-flex items-center gap-1 cursor-pointer group select-none",
        className
      )}
    >
      <span className="font-mono">{display ?? id}</span>
      <span className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {copied
          ? <Check className="h-3 w-3 text-green-500" />
          : <Copy className="h-3 w-3 text-muted-foreground" />
        }
      </span>
    </span>
  );
}
