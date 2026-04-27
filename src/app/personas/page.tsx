export const dynamic = "force-dynamic";

import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/charts/metric-card";
import { PersonaCard } from "@/components/personas/persona-card";
import { Persona } from "@/types/persona";
import { Users2, TrendingUp, Star, Sparkles } from "lucide-react";
import { AudienceDistribution } from "@/components/personas/audience-distribution";
import { formatNumber } from "@/lib/utils";
import { prisma } from "@/lib/db";

async function getPersonas(): Promise<Persona[]> {
  try {
    const rows = await prisma.persona.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { users: true } } },
    });
    return rows as unknown as Persona[];
  } catch {
    return [];
  }
}

export default async function PersonasPage() {
  const personas = await getPersonas();

  const manualPersonas = personas.filter((p) => p.source === "manual");
  const discoveredPersonas = personas.filter((p) => p.source === "discovered");

  // Real assigned users (from DB _count), not mock metrics
  const assignedUsers = personas.reduce((s, p) => s + (p._count?.users ?? 0), 0);
  const totalUsers = personas.reduce((s, p) => s + (p.metrics?.userCount ?? p._count?.users ?? 0), 0);
  const avgConvRate =
    personas.length > 0
      ? personas.reduce((s, p) => s + (p.metrics?.conversionRate ?? 0), 0) / personas.length
      : 0;

  const highestLtvPersona = personas.reduce<Persona | null>(
    (best, p) => (!best || (p.metrics?.ltv ?? 0) > (best.metrics?.ltv ?? 0) ? p : best),
    null
  );

  const description =
    personas.length === 0
      ? "No personas yet — seed the database to get started"
      : `${personas.length} user segment${personas.length !== 1 ? "s" : ""} — ${manualPersonas.length} manual, ${discoveredPersonas.length} discovered`;

  return (
    <>
      <Header title="Personas" description={description} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Total Personas"
            value={personas.length}
            description="behavioral segments"
            icon={Users2}
          />
          <MetricCard
            title="Total Users"
            value={formatNumber(totalUsers)}
            description="across all segments"
            icon={Users2}
            trend={4.2}
          />
          <MetricCard
            title="Avg Conv. Rate"
            value={`${avgConvRate.toFixed(1)}%`}
            description="across all personas"
            icon={TrendingUp}
          />
          <MetricCard
            title="Highest LTV"
            value={highestLtvPersona ? `${highestLtvPersona.metrics?.ltv ?? "—"}/10` : "—"}
            description={highestLtvPersona?.name ?? ""}
            icon={Star}
          />
        </div>

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

        {personas.length === 0 && (
          <div className="text-center py-16 text-muted-foreground border-2 border-dashed rounded-xl">
            <Users2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No personas in database</p>
            <p className="text-sm mt-1">
              Run the seed script to load the 12 default personas, or use the discovery engine once users accumulate behavioral data.
            </p>
            <p className="text-xs font-mono mt-3 bg-muted inline-block px-3 py-1 rounded">
              npx tsx prisma/seed-personas.ts
            </p>
          </div>
        )}
      </div>
    </>
  );
}
