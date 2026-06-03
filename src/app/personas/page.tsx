export const revalidate = 60;
export const maxDuration = 30;

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
import { unstable_cache } from "next/cache";
import { cache } from "react";
import Link from "next/link";

/**
 * Cheap KPI aggregate — two indexed counts + one name lookup. Independent of the
 * heavier full-persona-list query so the metric cards paint before the grids.
 */
const getPersonaKpis = cache(
  unstable_cache(
    async () => {
      const [totalPersonas, assignedUsers, firstPersona] = await Promise.all([
        prisma.persona.count(),
        prisma.trackedUser.count({ where: { personaId: { not: null } } }),
        prisma.persona.findFirst({ orderBy: { createdAt: "asc" }, select: { name: true } }),
      ]);
      return { totalPersonas, assignedUsers, topPersonaName: firstPersona?.name ?? "" };
    },
    ["personas-kpis"],
    { tags: ["personas"], revalidate: 900 }
  )
);

const getPersonas = cache(
  unstable_cache(
    async (): Promise<Persona[]> => {
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
          silhouetteScore: true,
          discoveredAt: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { trackedUsers: true } },
        },
      });
      return rows as unknown as Persona[];
    },
    ["personas-list"],
    { tags: ["personas"], revalidate: 900 }
  )
);

async function KpiSection() {
  const { totalPersonas, assignedUsers, topPersonaName } = await getPersonaKpis().catch(() => ({
    totalPersonas: 0,
    assignedUsers: 0,
    topPersonaName: "",
  }));

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
        value="0.0%"
        description="across all personas"
        icon={TrendingUp}
      />
      <MetricCard
        title="Highest LTV"
        value={totalPersonas > 0 ? "—/10" : "—"}
        description={topPersonaName}
        icon={Star}
      />
    </div>
  );
}

async function PersonaGridsSection() {
  const personas = await getPersonas().catch(() => [] as Persona[]);

  const manualPersonas = personas.filter((p) => p.source === "manual");
  const discoveredPersonas = personas.filter((p) => p.source === "discovered");
  const assignedUsers = personas.reduce((s, p) => s + (p._count?.trackedUsers ?? 0), 0);

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
  // Warm both queries in parallel on entry; each Suspense boundary below then
  // resolves from cache and streams independently.
  void getPersonaKpis();
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
