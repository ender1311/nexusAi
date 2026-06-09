import type { ValueCount } from "./facet-types";
import { countryNameOf, languageNameOf } from "./facet-labels";

function friendlyName(fieldId: string, value: string): string {
  if (fieldId === "country_latest") return countryNameOf(value) ?? "";
  if (fieldId === "language_tag") return languageNameOf(value) ?? "";
  return "";
}

/**
 * Case-insensitive substring match on BOTH the raw value and its friendly name,
 * so a user typing "united" finds "US". Input is already count-desc; we filter
 * in place, preserving that order.
 */
export function filterFacetValues(values: ValueCount[], query: string, fieldId: string): ValueCount[] {
  const q = query.trim().toLowerCase();
  if (q === "") return values;
  return values.filter(({ value }) => {
    const name = friendlyName(fieldId, value).toLowerCase();
    return value.toLowerCase().includes(q) || name.includes(q);
  });
}
