export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { Suspense, cache } from "react";
import { Header } from "@/components/layout/header";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createHightouchClient } from "@/lib/hightouch/client";
import type { HightouchSync } from "@/lib/hightouch/types";
import { HealthBanner } from "@/components/data-ingest/health-banner";
import { SyncsTable } from "@/components/data-ingest/syncs-table";
import { ModelsTable } from "@/components/data-ingest/models-table";
import { SourcesDestinations } from "@/components/data-ingest/sources-destinations";
import { EventPushForm } from "@/components/data-ingest/event-push-form";

// ---------------------------------------------------------------------------
// React.cache() wrappers — dedup calls across Suspense boundaries
// ---------------------------------------------------------------------------

const getCachedSyncs = cache(async (): Promise<{ syncs: HightouchSync[]; error?: string }> => {
  const client = createHightouchClient();
  if (!client) return { syncs: [] };
  try {
    const syncs = await client.listSyncs();
    return { syncs };
  } catch (err) {
    return { syncs: [], error: err instanceof Error ? err.message : String(err) };
  }
});

const getCachedModels = cache(() =>
  createHightouchClient()?.listModels().catch(() => []) ?? Promise.resolve([]),
);

const getCachedSources = cache(() =>
  createHightouchClient()?.listSources().catch(() => []) ?? Promise.resolve([]),
);

const getCachedDestinations = cache(() =>
  createHightouchClient()?.listDestinations().catch(() => []) ?? Promise.resolve([]),
);

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function HealthBannerSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-2 p-3">
            <Skeleton className="h-4 w-4 rounded" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-3 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-full" />
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

function CardTableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <TableSkeleton />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Async sub-components
// ---------------------------------------------------------------------------

async function HealthBannerSection() {
  const [{ syncs }, destinations, models] = await Promise.all([
    getCachedSyncs(),
    getCachedDestinations(),
    getCachedModels(),
  ]);
  const destMap = new Map(destinations.map((d) => [String(d.id), d]));
  const modelMap = new Map(models.map((m) => [String(m.id), m]));
  const nexusSyncs = syncs.filter((s) => {
    const dest = destMap.get(String(s.destinationId));
    const destNexus =
      (dest?.name ?? "").toLowerCase().includes("nexus") ||
      (dest?.slug ?? "").toLowerCase().includes("nexus");
    const model = modelMap.get(String(s.modelId));
    const modelNexus =
      (model?.name ?? "").toLowerCase().includes("nexus") ||
      (model?.slug ?? "").toLowerCase().includes("nexus");
    return destNexus || modelNexus || s.slug.toLowerCase().includes("nexus");
  });
  return <HealthBanner syncs={nexusSyncs} />;
}

async function SyncsSection() {
  const [{ syncs, error }, models, destinations] = await Promise.all([
    getCachedSyncs(),
    getCachedModels(),
    getCachedDestinations(),
  ]);
  return (
    <SyncsTable
      syncs={syncs}
      models={models}
      destinations={destinations}
      hasApiKey={!!process.env.HIGHTOUCH_API_KEY}
      apiError={error}
    />
  );
}

async function ModelsSection() {
  const models = await getCachedModels();
  return <ModelsTable models={models} />;
}

async function SourcesDestinationsSection() {
  const [sources, destinations] = await Promise.all([
    getCachedSources(),
    getCachedDestinations(),
  ]);
  return <SourcesDestinations sources={sources} destinations={destinations} />;
}

// ---------------------------------------------------------------------------
// Main page — synchronous shell, data streams via Suspense
// ---------------------------------------------------------------------------

export default function DataIngestPage() {
  // Pre-kick all fetches for React.cache() deduplication
  void getCachedSyncs();
  void getCachedModels();
  void getCachedSources();
  void getCachedDestinations();

  return (
    <>
      <Header title="Data Ingest" description="Hightouch sync management" />
      <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
        <Suspense fallback={<HealthBannerSkeleton />}>
          <HealthBannerSection />
        </Suspense>

        <Tabs defaultValue="syncs">
          <div className="overflow-x-auto overflow-y-hidden overscroll-x-contain -mx-4 px-4 sm:mx-0 sm:px-0 [touch-action:pan-x]">
            <TabsList className="w-max">
              <TabsTrigger value="syncs">Syncs</TabsTrigger>
              <TabsTrigger value="models">Models</TabsTrigger>
              <TabsTrigger value="sources">Sources &amp; Destinations</TabsTrigger>
              <TabsTrigger value="push">Push Events</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="syncs" className="mt-4">
            <Suspense fallback={<TableSkeleton />}>
              <SyncsSection />
            </Suspense>
          </TabsContent>

          <TabsContent value="models" className="mt-4">
            <Suspense fallback={<CardTableSkeleton />}>
              <ModelsSection />
            </Suspense>
          </TabsContent>

          <TabsContent value="sources" className="mt-4">
            <Suspense fallback={<div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><CardTableSkeleton /><CardTableSkeleton /></div>}>
              <SourcesDestinationsSection />
            </Suspense>
          </TabsContent>

          <TabsContent value="push" className="mt-4">
            <EventPushForm />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
