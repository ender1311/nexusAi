import { contentItemSchema, type ContentChannel, type ContentItem, type FieldMapping } from "./types";

const TOKEN = /([^.[\]]+)|\[(\d+|\*)\]/g;

/** Reads `a.b[0].c` and `a[*].b` (collect). Returns undefined for any missing hop. */
export function getPath(obj: unknown, path: string): unknown {
  const tokens = [...path.matchAll(TOKEN)].map((m) => m[1] ?? m[2]!);
  let cur: unknown[] = [obj];
  let collecting = false;
  for (const t of tokens) {
    const next: unknown[] = [];
    for (const c of cur) {
      if (t === "*") {
        if (Array.isArray(c)) next.push(...c);
        collecting = true;
      } else if (c !== null && typeof c === "object") {
        const v = Array.isArray(c) && /^\d+$/.test(t) ? c[Number(t)] : (c as Record<string, unknown>)[t];
        if (v !== undefined) next.push(v);
      }
    }
    cur = next;
  }
  if (collecting) return cur;
  return cur[0];
}

/**
 * A Contentful field is a locale map ({ "en-US": "…", "es": "…" }). Returns the
 * default-locale value and every locale's value. Non-map values pass through.
 */
function splitLocales(v: unknown): { value: unknown; byLocale?: Record<string, unknown> } {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > 0 && entries.every(([k]) => /^[a-z]{2}(-[A-Z]{2})?$/.test(k))) {
      const def = (v as Record<string, unknown>)["en-US"] ?? (v as Record<string, unknown>).en ?? entries[0]![1];
      return { value: def, byLocale: Object.fromEntries(entries) };
    }
  }
  return { value: v };
}

const asString = (v: unknown): string | undefined => {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
};

export function applyFieldMapping(
  record: unknown,
  mapping: FieldMapping,
  defaults: { channel: ContentChannel },
): { item: ContentItem } | { error: string } {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return { error: "record is not an object" };
  const ref = asString(splitLocales(getPath(record, mapping.externalRef ?? "id")).value) ?? "(no id)";
  const draft: Record<string, unknown> = { channel: defaults.channel, tags: [] };
  const locales: Record<string, Record<string, string>> = {};

  for (const [field, path] of Object.entries(mapping) as [keyof FieldMapping, string][]) {
    const { value, byLocale } = splitLocales(getPath(record, path));
    if (field === "tags") {
      const arr = Array.isArray(value) ? value : value === undefined ? [] : [value];
      draft.tags = arr.map(asString).filter((s): s is string => !!s);
      continue;
    }
    const s = asString(value);
    if (s !== undefined) draft[field] = s;
    if (byLocale && (field === "title" || field === "body" || field === "subject")) {
      for (const [loc, lv] of Object.entries(byLocale)) {
        const ls = asString(lv);
        if (ls && loc !== "en-US" && loc !== "en") (locales[loc] ??= {})[field] = ls;
      }
    }
  }
  if (Object.keys(locales).length) draft.locales = locales;
  draft.updatedAt ??= "1970-01-01T00:00:00Z";

  const parsed = contentItemSchema.safeParse(draft);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    return { error: `${ref}: invalid or missing ${fields}` };
  }
  return { item: parsed.data };
}
