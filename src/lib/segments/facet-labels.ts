import type { FieldType } from "@/types/segment";
import type { RangeFacetPayload } from "./facet-types";

// Friendly names come from the JS runtime's Intl.DisplayNames (CLDR data) rather
// than a hardcoded table: full coverage of every ISO region/language code, zero
// maintenance, and no giant literal list to ship. Codes the runtime can't name —
// or names as the CLDR placeholder "Unknown Region" / "Unknown Language" — fall
// back to the raw value so the picker still shows something meaningful.
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });

function clean(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (/^Unknown\b/.test(name)) return undefined;
  return name;
}

export function countryNameOf(code: string): string | undefined {
  try {
    return clean(regionNames.of(code));
  } catch {
    return undefined;
  }
}

export function languageNameOf(tag: string): string | undefined {
  try {
    return clean(languageNames.of(tag));
  } catch {
    return undefined;
  }
}

function nameFor(fieldId: string, value: string): string | undefined {
  if (fieldId === "country_latest") return countryNameOf(value);
  if (fieldId === "language_tag") return languageNameOf(value);
  return undefined;
}

export function formatFacetValueLabel(fieldId: string, value: string, count: number): string {
  const friendly = nameFor(fieldId, value);
  const countStr = count.toLocaleString("en-US");
  return friendly ? `${value} · ${friendly} — ${countStr}` : `${value} — ${countStr}`;
}

function fmt(type: FieldType, v: number | string): string {
  if (type === "date") return String(v).slice(0, 10); // ISO → YYYY-MM-DD
  return String(v);
}

export function formatRangeHint(type: FieldType, payload: RangeFacetPayload): string {
  return `In data: ${fmt(type, payload.min)}–${fmt(type, payload.max)} · median ${fmt(type, payload.p50)}`;
}
