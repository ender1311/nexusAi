import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HightouchModel } from "@/lib/hightouch/types";

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
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Name</th>
                  <th className="text-left font-medium px-4 py-2">Type</th>
                  <th className="text-left font-medium px-4 py-2">Source</th>
                  <th className="text-left font-medium px-4 py-2">Primary Key</th>
                  <th className="text-left font-medium px-4 py-2">Updated</th>
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
                      {model.sourceId.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-2 font-mono text-muted-foreground">
                      {model.primaryKey}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {formatUpdatedAt(model.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
