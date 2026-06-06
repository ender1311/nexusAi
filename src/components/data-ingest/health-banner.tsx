import { Activity, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { HightouchSync } from "@/lib/hightouch/types";
import { formatRelativeTime } from "@/lib/utils";

type HealthChipProps = {
  icon: LucideIcon;
  value: string | number;
  label: string;
  colorClass?: string;
};

function HealthChip({ icon: Icon, value, label, colorClass }: HealthChipProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2 p-3">
        <Icon className={colorClass ?? "h-4 w-4 text-muted-foreground"} />
        <div>
          <p className="text-sm font-semibold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

type HealthBannerProps = {
  syncs: HightouchSync[];
};

/**
 * Most-recent run timestamp across syncs, compared chronologically — NOT
 * lexically. ISO strings with differing timezone offsets (e.g. "+00:00" vs "Z")
 * don't sort correctly as raw strings, which would surface the wrong time.
 */
export function latestRunAt(syncs: HightouchSync[]): string | null {
  return (
    syncs
      .map((s) => s.lastRunAt)
      .filter((d): d is string => d !== null)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .at(-1) ?? null
  );
}

export function HealthBanner({ syncs }: HealthBannerProps) {
  if (syncs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No syncs configured</p>
    );
  }

  const healthy = syncs.filter(
    (s) => s.status === "success" || s.status === "running",
  ).length;
  const failed = syncs.filter((s) => s.status === "failed").length;
  const healthPct = syncs.length > 0 ? Math.round((healthy / syncs.length) * 100) : 0;

  const lastRunAt = latestRunAt(syncs);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <HealthChip
        icon={Activity}
        value={syncs.length}
        label="Total syncs"
      />
      <HealthChip
        icon={CheckCircle2}
        value={`${healthy} (${healthPct}%)`}
        label="Healthy"
        colorClass="h-4 w-4 text-green-600"
      />
      <HealthChip
        icon={AlertCircle}
        value={failed}
        label="Failed"
        colorClass={failed > 0 ? "h-4 w-4 text-red-600" : "h-4 w-4 text-muted-foreground"}
      />
      <HealthChip
        icon={Clock}
        value={formatRelativeTime(lastRunAt ?? null)}
        label="Last synced"
      />
    </div>
  );
}
