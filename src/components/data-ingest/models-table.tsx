"use client";

import { useState } from "react";
import { Code } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HightouchModel } from "@/lib/hightouch/types";
import { ModelSqlViewer } from "./model-sql-viewer";

function queryTypeClasses(queryType: HightouchModel["queryType"]): string {
  switch (queryType) {
    case "custom_sql":
      return "bg-blue-500/15 text-blue-700 border-transparent";
    case "table":
      return "bg-muted text-muted-foreground border-transparent";
    case "dbt_model":
      return "bg-green-500/15 text-green-700 border-transparent";
    case "visual":
      return "bg-purple-500/15 text-purple-700 border-transparent";
    default:
      return "bg-muted text-muted-foreground border-transparent";
  }
}

function formatUpdatedAt(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));
}

type ModelsTableProps = {
  models: HightouchModel[];
};

export function ModelsTable({ models }: ModelsTableProps) {
  const [selected, setSelected] = useState<HightouchModel | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold">Models</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8 px-4">
            No models configured.
          </p>
        ) : (
          <div className="rounded-b-lg overflow-hidden">
            {/* Mobile: card list */}
            <ul className="sm:hidden divide-y">
              {models.map((model) => (
                <li key={model.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-medium truncate">{model.name}</p>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("text-xs shrink-0", queryTypeClasses(model.queryType))}
                      >
                        {model.queryType.replaceAll("_", " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatUpdatedAt(model.updatedAt)}
                      </span>
                    </div>
                  </div>
                  {model.sql !== null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => setSelected(model)}
                      title="View SQL"
                    >
                      <Code className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {/* Desktop: table */}
            <table className="hidden sm:table w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Name</th>
                  <th className="text-left font-medium px-4 py-2">Type</th>
                  <th className="text-left font-medium px-4 py-2">Source</th>
                  <th className="text-left font-medium px-4 py-2">Primary Key</th>
                  <th className="text-left font-medium px-4 py-2">Updated</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model.id} className="border-t">
                    <td className="px-4 py-2 font-medium">{model.name}</td>
                    <td className="px-4 py-2">
                      <Badge
                        variant="outline"
                        className={cn("text-xs", queryTypeClasses(model.queryType))}
                      >
                        {model.queryType.replaceAll("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 font-mono text-muted-foreground">
                      {String(model.sourceId).slice(0, 8)}…
                    </td>
                    <td className="px-4 py-2 font-mono text-muted-foreground">
                      {model.primaryKey}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatUpdatedAt(model.updatedAt)}
                    </td>
                    <td className="px-4 py-2">
                      {model.sql !== null && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => setSelected(model)}
                          title="View SQL"
                        >
                          <Code className="h-3 w-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {selected?.sql && (
        <ModelSqlViewer
          modelName={selected.name}
          sql={selected.sql}
          open={!!selected}
          onOpenChange={(open) => { if (!open) setSelected(null); }}
        />
      )}
    </Card>
  );
}
