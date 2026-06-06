"use client";

import { DeeplinkSelect } from "./deeplink-select";
import { warnVerseOverride, CONTENT_MISMATCH_WARNING } from "@/lib/deeplinks/content-mismatch";

type Props = {
  value: string;            // "" = no override
  onChange: (value: string) => void;
  hasVerseVariants: boolean;
};

export function AgentDeeplinkOverrideField({ value, onChange, hasVerseVariants }: Props) {
  const showWarning = warnVerseOverride({ hasVerseVariants, override: value });
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Link all variants to…</label>
      <p className="text-xs text-muted-foreground">
        Optional. When set, every variant&apos;s deeplink is replaced by this one URL.
      </p>
      <DeeplinkSelect value={value} onChange={onChange} />
      {showWarning && (
        <p className="text-xs text-amber-600 dark:text-amber-500" role="alert">
          {CONTENT_MISMATCH_WARNING}
        </p>
      )}
    </div>
  );
}
