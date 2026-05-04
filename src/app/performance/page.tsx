import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/charts/metric-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { DailySendsChart } from "@/components/charts/bar-chart";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { ExplorationRatio } from "@/components/charts/exploration-ratio";
import { TimingHeatmap } from "@/components/charts/timing-heatmap";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { globalTimeSeries, agentMetrics, variantMetrics, timingHeatmap } from "@/lib/mock/metrics";
import { formatNumber, formatPercent } from "@/lib/utils";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, Send, Zap, GitCompare } from "lucide-react";
import { AgentStatus } from "@/types/agent";

function LiftBadge({ lift }: { lift: number }) {
  if (lift > 5) return (
    <span className="flex items-center gap-1 text-green-600 font-medium text-sm">
      <TrendingUp className="h-3.5 w-3.5" />+{lift}%
    </span>
  );
  if (lift < -5) return (
    <span className="flex items-center gap-1 text-red-500 font-medium text-sm">
      <TrendingDown className="h-3.5 w-3.5" />{lift}%
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-muted-foreground text-sm">
      <Minus className="h-3.5 w-3.5" />{lift}%
    </span>
  );
}

export default function PerformancePage() {
  const allVariants = Object.values(variantMetrics).flat();
  const last30 = globalTimeSeries;
  const last7 = globalTimeSeries.slice(-7);

  return (
    <>
      <Header title="Performance" description="Global Nexus metrics" />
      <div className="p-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            title="Total Sends (30d)"
            value={formatNumber(last30.reduce((s, d) => s + d.sends, 0))}
            icon={Send}
          />
          <MetricCard
            title="Avg Conv. Rate"
            value={formatPercent(last30.reduce((s, d) => s + d.conversionRate, 0) / last30.length)}
            icon={TrendingUp}
          />
          <MetricCard
            title="Best Agent Lift"
            value={`+${Math.max(...agentMetrics.map((m) => m.liftVsControl))}%`}
            icon={Zap}
          />
          <MetricCard
            title="Active Variants"
            value={allVariants.length}
            icon={GitCompare}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold">Conversion Rate Trend (30 days)</CardTitle>
              <Badge variant="outline" className="text-xs">All Agents</Badge>
            </CardHeader>
            <CardContent>
              <TimeSeriesChart data={last30} height={240} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Daily Send Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <DailySendsChart data={last7} height={240} />
            </CardContent>
          </Card>
        </div>

        {/* Per-agent table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Agent Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-semibold">Agent</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="text-right font-semibold">Sends</TableHead>
                  <TableHead className="text-right font-semibold">Conversions</TableHead>
                  <TableHead className="text-right font-semibold">Conv. Rate</TableHead>
                  <TableHead className="text-right font-semibold">Lift vs Control</TableHead>
                  <TableHead className="text-right font-semibold">Explore %</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentMetrics.map((m) => (
                  <TableRow key={m.agentId}>
                    <TableCell className="font-medium">{m.agentName}</TableCell>
                    <TableCell>
                      <AgentStatusBadge status={m.status as AgentStatus} />
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(m.sends)}</TableCell>
                    <TableCell className="text-right">{formatNumber(m.conversions)}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">
                      {formatPercent(m.conversionRate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <LiftBadge lift={m.liftVsControl} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{m.exploreRatio}%</TableCell>
                    <TableCell>
                      <Link href={`/agents/${m.agentId}/performance`}>
                        <Button variant="outline" size="sm" className="h-7 text-xs">View</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Variant comparison */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">All Variants (Recommend Agent)</CardTitle>
            </CardHeader>
            <CardContent>
              <VariantComparison variants={variantMetrics["agent_001"] ?? []} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Explore / Deliver (Recommend)</CardTitle>
            </CardHeader>
            <CardContent>
              <ExplorationRatio explorePercent={12} />
            </CardContent>
          </Card>
        </div>

        {/* Timing heatmap */}
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
