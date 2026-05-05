import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockAgents } from "@/lib/mock/agents";
import { agentMetrics, variantMetrics, agentTimeSeries, timingHeatmap } from "@/lib/mock/metrics";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { DailySendsChart } from "@/components/charts/bar-chart";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { ExplorationRatio } from "@/components/charts/exploration-ratio";
import { TimingHeatmap } from "@/components/charts/timing-heatmap";
import { formatNumber } from "@/lib/utils";

export default async function AgentPerformancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = mockAgents.find((a) => a.id === id);
  if (!agent) notFound();

  const metric = agentMetrics.find((m) => m.agentId === id);
  const variants = variantMetrics[id] ?? [];
  const timeSeries = agentTimeSeries[id] ?? [];

  if (!metric || timeSeries.length === 0) {
    return (
      <>
        <Header title="Performance" description={agent.name} />
        <div className="p-6 text-center text-muted-foreground">
          <p>No performance data yet.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Agent Performance" description={agent.name} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Sends</p>
              <p className="text-2xl font-bold mt-1">{formatNumber(metric.sends)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Conversions</p>
              <p className="text-2xl font-bold mt-1">{formatNumber(metric.conversions)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Conv. Rate</p>
              <p className="text-2xl font-bold mt-1 text-primary">{metric.conversionRate.toFixed(2)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Lift vs Random</p>
              <p className="text-2xl font-bold mt-1 text-green-600">+{metric.liftVsControl}%</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Conversion Rate Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeSeriesChart data={timeSeries} height={240} showSends />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Daily Send Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <DailySendsChart data={timeSeries} height={240} />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {variants.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Variant Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <VariantComparison variants={variants} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Exploration Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <ExplorationRatio explorePercent={metric.exploreRatio} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Best Send Times (Discovered)</CardTitle>
          </CardHeader>
          <CardContent>
            <TimingHeatmap data={timingHeatmap} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
