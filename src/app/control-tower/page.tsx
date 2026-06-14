export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { AgentToggleGrid } from "@/components/control-tower/agent-toggle-grid";
import { FunnelStageBreakdown } from "@/components/charts/funnel-stage-breakdown";
import { UserInspector } from "@/components/control-tower/user-inspector";
import { CronRuns } from "@/components/control-tower/cron-runs";
import { getAuth } from "@/lib/auth";
import { KillSwitchToggle } from "@/components/control-tower/kill-switch-toggle";
import {
  getCachedControlTowerAgents,
  getCachedFunnelStageBreakdown,
  getCachedKillSwitchSetting,
} from "@/lib/cache";

// ── Sections ─────────────────────────────────────────────────────────────────
// Each awaits exactly one cached fn so it streams independently — a slow section
// never blocks the header or the others from painting.

async function AgentTogglesSection() {
  const agents = await getCachedControlTowerAgents().catch(() => []);
  return <AgentToggleGrid agents={agents} />;
}

async function KillSwitchSection() {
  const [{ isAdmin }, setting] = await Promise.all([
    getAuth(),
    getCachedKillSwitchSetting(),
  ]);
  if (!isAdmin) return null;
  return (
    <div className="px-4 sm:px-6 pt-3 flex justify-end">
      <KillSwitchToggle initialOn={setting?.value === "true"} />
    </div>
  );
}

async function FunnelSection() {
  const funnelBreakdown = await getCachedFunnelStageBreakdown().catch(() => []);
  if (funnelBreakdown.length === 0) return null;
  return <FunnelStageBreakdown rows={funnelBreakdown} title="Users by Stage" />;
}


export default function ControlTowerPage() {
  // Warm all section caches in parallel on entry so every Suspense boundary
  // resolves from cache instead of racing cold DB queries.
  void getCachedControlTowerAgents();
  void getCachedFunnelStageBreakdown();

  return (
    <div className="flex flex-col min-h-0">
      <Header title="Control Tower" description="AI-Powered Optimization Command Center" />

      <Suspense fallback={null}>
        <KillSwitchSection />
      </Suspense>

      {/* Main content */}
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Agent cards — span 2 cols */}
          <div className="lg:col-span-2">
            <Suspense fallback={null}>
              <AgentTogglesSection />
            </Suspense>
          </div>

          {/* Funnel breakdown */}
          <div className="space-y-4">
            <Suspense fallback={null}>
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
