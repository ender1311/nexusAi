// force-dynamic: this page must NOT be prerendered at build time. Static
// generation runs the per-persona TrackedUser counts against the production
// DB during `next build`; on a cold 2-CU Neon compute that exceeds the 60s
// page-build limit and fails the whole deploy. Runtime caching is handled by
// unstable_cache below (15 min, tag "personas").
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { Suspense } from "react";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/charts/metric-card";
import { PersonaCard } from "@/components/personas/persona-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Persona } from "@/types/persona";
import { Users2, TrendingUp, Star, Sparkles } from "lucide-react";
import { AudienceDistribution } from "@/components/personas/audience-distribution";
import { formatNumber } from "@/lib/utils";
import { prisma } from "@/lib/db";
import { isDemoMode } from "@/lib/auth/demo";
import { demoPersonas } from "@/lib/mock/personas";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import Link from "next/link";

const getPersonas = cache(
  unstable_cache(
    async (): Promise<Persona[]> => {
      if (isDemoMode()) return demoPersonas;
      const rows = await prisma.persona.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          label: true,
          icon: true,
          color: true,
          source: true,
          isActive: true,
          description: true,
          tags: true,
          clusterSize: true,
          userCount: true,
          silhouetteScore: true,
          discoveredAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return rows as unknown as Persona[];
    },
    ["personas-list"],
    { tags: ["personas"], revalidate: 900 }
  )
);

async function KpiSection() {
  // Derive KPIs from the per-persona counts the grids already need, deduped via
  // React cache(). Avoids a standalone COUNT over ~34M TrackedUser rows (~22s),
  // which exceeded this route's maxDuration and surfaced as "connection closed".
  const personas = await getPersonas().catch(() => [] as Persona[]);
  const totalPersonas = personas.length;
  const assignedUsers = personas.reduce((s, p) => s + (p.userCount ?? 0), 0);
  const topPersonaName = personas[0]?.name ?? "";

  // Derive conversion + LTV KPIs from persona metrics when present (demo/seeded
  // data). Discovered personas from the DB may lack metrics, in which case these
  // fall back to the empty-state display.
  const withMetrics = personas.filter((p) => p.metrics);
  const convUsers = withMetrics.reduce((s, p) => s + (p.userCount ?? 0), 0);
  const avgConv =
    convUsers > 0
      ? withMetrics.reduce((s, p) => s + p.metrics!.conversionRate * (p.userCount ?? 0), 0) / convUsers
      : 0;
  const topLtvPersona = withMetrics.reduce<Persona | null>(
    (best, p) => (!best || p.metrics!.ltv > best.metrics!.ltv ? p : best),
    null
  );

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <MetricCard
        title="Total Personas"
        value={totalPersonas}
        description="behavioral segments"
        icon={Users2}
      />
      <MetricCard
        title="Total Users"
        value={formatNumber(assignedUsers)}
        description="across all segments"
        icon={Users2}
        trend={4.2}
      />
      <MetricCard
        title="Avg Conv. Rate"
        value={avgConv > 0 ? `${avgConv.toFixed(1)}%` : "0.0%"}
        description="across all personas"
        icon={TrendingUp}
      />
      <MetricCard
        title="Highest LTV"
        value={topLtvPersona ? `${topLtvPersona.metrics!.ltv}/10` : totalPersonas > 0 ? "—/10" : "—"}
        description={topLtvPersona?.name ?? topPersonaName}
        icon={Star}
      />
    </div>
  );
}

async function PersonaGridsSection() {
  const personas = await getPersonas().catch(() => [] as Persona[]);

  const manualPersonas = personas.filter((p) => p.source === "manual");
  const discoveredPersonas = personas.filter((p) => p.source === "discovered");
  const assignedUsers = personas.reduce((s, p) => s + (p.userCount ?? 0), 0);

  if (personas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl text-muted-foreground">
        <Users2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">No personas configured</p>
        <p className="text-sm mt-1">
          Personas define your user behavioral segments. Use the Settings page to run persona discovery once users have accumulated engagement data.
        </p>
        <Link href="/settings" className="mt-4">
          <Button size="sm" variant="outline">
            Go to Settings
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      {assignedUsers > 0 && (
        <AudienceDistribution personas={personas} totalUsers={assignedUsers} />
      )}

      {manualPersonas.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <Users2 className="h-4 w-4" />
            Manual Personas ({manualPersonas.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {manualPersonas.map((persona) => (
              <PersonaCard key={persona.id} persona={persona} totalUsers={assignedUsers} />
            ))}
          </div>
        </section>
      )}

      {discoveredPersonas.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4" />
            Discovered Personas ({discoveredPersonas.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {discoveredPersonas.map((persona) => (
              <PersonaCard key={persona.id} persona={persona} totalUsers={assignedUsers} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-24 rounded-xl border bg-muted animate-pulse" />
      ))}
    </div>
  );
}

function GridsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  );
}

export default function PersonasPage() {
  // Warm the shared persona query on entry; both Suspense boundaries below then
  // resolve from the deduped cache() promise.
  void getPersonas();

  return (
    <>
      <Header title="Personas" description="User behavioral segments" />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <Suspense fallback={<KpiSkeleton />}>
          <KpiSection />
        </Suspense>
        <Suspense fallback={<GridsSkeleton />}>
          <PersonaGridsSection />
        </Suspense>
      </div>
    </>
  );
}
