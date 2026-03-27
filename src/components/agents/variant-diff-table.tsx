import { MessageVariant } from "@/types/agent";
import { cn } from "@/lib/utils";

interface VariantDiffTableProps {
  variants: MessageVariant[];
}

const DIFF_FIELDS: Array<{ key: keyof MessageVariant; label: string }> = [
  { key: "name", label: "Name" },
  { key: "title", label: "Title" },
  { key: "body", label: "Body" },
  { key: "deeplink", label: "Deeplink" },
  { key: "iconImageUrl", label: "Icon URL" },
  { key: "cta", label: "CTA" },
  { key: "preferredHour", label: "Send Hour" },
  { key: "preferredDayOfWeek", label: "Send Day" },
  { key: "frequencyCapOverride", label: "Freq. Cap Override" },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatValue(key: keyof MessageVariant, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "preferredHour" && typeof value === "number") {
    const h = value % 12 || 12;
    return `${h}:00 ${value < 12 ? "AM" : "PM"}`;
  }
  if (key === "preferredDayOfWeek" && typeof value === "number") {
    return DAY_NAMES[value] ?? String(value);
  }
  return String(value);
}

export function VariantDiffTable({ variants }: VariantDiffTableProps) {
  if (variants.length < 2) {
    return <p className="text-sm text-muted-foreground text-center py-4">Need at least 2 variants to compare.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 pr-4 text-muted-foreground font-medium text-xs w-32">Field</th>
            {variants.map((v) => (
              <th key={v.id} className="text-left py-2 px-2 font-medium text-xs">
                {v.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DIFF_FIELDS.map(({ key, label }) => {
            const values = variants.map((v) => v[key] ?? null);
            const unique = new Set(values.map((val) => JSON.stringify(val)));
            const differs = unique.size > 1;

            // Skip rows where all variants have no value
            const hasAnyValue = values.some((val) => val !== null && val !== undefined && val !== "");
            if (!hasAnyValue) return null;

            return (
              <tr key={key} className={cn("border-b last:border-0", differs && "bg-amber-50/50")}>
                <td className="py-2 pr-4 text-xs text-muted-foreground font-medium">
                  {label}
                  {differs && <span className="ml-1 text-amber-600">*</span>}
                </td>
                {variants.map((v, i) => (
                  <td
                    key={v.id}
                    className={cn(
                      "py-2 px-2 text-xs",
                      differs && values[i] !== values[0] && "font-medium text-amber-700"
                    )}
                  >
                    {formatValue(key, values[i])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {DIFF_FIELDS.some(({ key }) => {
        const values = variants.map((v) => v[key] ?? null);
        const unique = new Set(values.map((val) => JSON.stringify(val)));
        return unique.size > 1;
      }) && (
        <p className="text-xs text-amber-600 mt-2">* Fields marked with * differ across variants</p>
      )}
    </div>
  );
}
