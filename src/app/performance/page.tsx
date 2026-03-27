import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { DailySendsChart } from "@/components/charts/bar-chart";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { ExplorationRatio } from "@/components/charts/exploration-ratio";
import { TimingHeatmap } from "@/components/charts/timing-heatmap";
import { globalTimeSeries, agentMetrics, variantMetrics, timingHeatmap } from "@/lib/mock/metrics";
import { formatNumber, formatPercent } from "@/lib/utils";
import Link from "next/link";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

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
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Sends (30d)</p>
              <p className="text-2xl font-bold mt-1">
                {formatNumber(last30.reduce((s, d) => s + d.sends, 0))}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Avg Conv. Rate</p>
              <p className="text-2xl font-bold mt-1 text-primary">
                {formatPercent(last30.reduce((s, d) => s + d.conversionRate, 0) / last30.length)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Best Agent Lift</p>
              <p className="text-2xl font-bold mt-1 text-green-600">
                +{Math.max(...agentMetrics.map((m) => m.liftVsControl))}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Active Variants</p>
              <p className="text-2xl font-bold mt-1">{allVariants.length}</p>
            </CardContent>
          </Card>
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
                  <TableHead>Agent</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sends</TableHead>
                  <TableHead className="text-right">Conversions</TableHead>
                  <TableHead className="text-right">Conv. Rate</TableHead>
                  <TableHead className="text-right">Lift vs Control</TableHead>
                  <TableHead className="text-right">Explore %</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentMetrics.map((m) => (
                  <TableRow key={m.agentId}>
                    <TableCell className="font-medium">{m.agentName}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          m.status === "active"
                            ? "text-green-700 bg-green-50 text-xs"
                            : "text-gray-600 bg-gray-50 text-xs"
                        }
                      >
                        {m.status}
                      </Badge>
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
                        <Button variant="ghost" size="sm" className="h-7 text-xs">View</Button>
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
