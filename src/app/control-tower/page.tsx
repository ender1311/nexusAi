export const revalidate = 60;
export const maxDuration = 30;

import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { Skeleton } from "@/components/ui/skeleton";
import { ControlTowerStatsBar } from "@/components/control-tower/control-tower-stats-bar";
import { AgentToggleGrid } from "@/components/control-tower/agent-toggle-grid";
import { FunnelStageBreakdown } from "@/components/charts/funnel-stage-breakdown";
import { UserInspector } from "@/components/control-tower/user-inspector";
import { CronRuns } from "@/components/control-tower/cron-runs";
import {
  getCachedControlTowerAgents,
  getCachedControlTowerStats,
  getCachedFunnelStageBreakdown,
  getCachedFleetRecoveryStats,
} from "@/lib/cache";

// ── Sections ─────────────────────────────────────────────────────────────────
// Each awaits exactly one cached fn so it streams independently — a slow section
// never blocks the header, stats bar, or the others from painting.

async function StatsBarSection() {
  // brazeSends omitted — external HTTP call (up to 3s on cold start). stats.totalDecisions
  // is a reliable fallback rendered by ControlTowerStatsBar.
  const [stats, recovery] = await Promise.all([
    getCachedControlTowerStats().catch(() => null),
    getCachedFleetRecoveryStats().catch(() => ({ recoveries30d: 0, attributedRecoveries30d: 0, fleetRecoveryRate: 0 })),
  ]);
  return <ControlTowerStatsBar stats={stats} brazeSends={null} recovery={recovery} />;
}

async function AgentTogglesSection() {
  const agents = await getCachedControlTowerAgents().catch(() => []);
  return <AgentToggleGrid agents={agents} />;
}

async function FunnelSection() {
  const funnelBreakdown = await getCachedFunnelStageBreakdown().catch(() => []);
  if (funnelBreakdown.length === 0) return null;
  return <FunnelStageBreakdown rows={funnelBreakdown} title="Users by Stage" />;
}

// ── Skeletons ────────────────────────────────────────────────────────────────

function StatsBarSkeleton() {
  return (
    <div className="border-b bg-muted/30 px-4 sm:px-6 py-2 sm:py-2.5 flex items-center gap-6 shrink-0">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-4 w-28" />
      ))}
    </div>
  );
}

function AgentGridSkeleton() {
  return (
    <>
      <Skeleton className="h-5 w-40 mb-3" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    </>
  );
}

export default function ControlTowerPage() {
  // Warm all section caches in parallel on entry so every Suspense boundary
  // resolves from cache instead of racing cold DB queries.
  void getCachedControlTowerStats();
  void getCachedControlTowerAgents();
  void getCachedFunnelStageBreakdown();
  void getCachedFleetRecoveryStats();

  return (
    <div className="flex flex-col min-h-0">
      <Header title="Control Tower" description="AI-Powered Optimization Command Center" />

      <Suspense fallback={<StatsBarSkeleton />}>
        <StatsBarSection />
      </Suspense>

      {/* Main content */}
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Agent cards — span 2 cols */}
          <div className="lg:col-span-2">
            <Suspense fallback={<AgentGridSkeleton />}>
              <AgentTogglesSection />
            </Suspense>
          </div>

          {/* Funnel breakdown */}
          <div className="space-y-4">
            <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
              <FunnelSection />
            </Suspense>
          </div>
        </div>

        {/* User inspector — self-fetching client component */}
        <div className="border-t pt-6">
          <UserInspector />
        </div>

        {/* Cron run history — self-fetching client component */}
        <div className="border-t pt-6">
          <CronRuns />
        </div>
      </div>
    </div>
  );
}
