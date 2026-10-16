import { contentItemSchema, type ContentChannel, type ContentItem, type FieldMapping } from "./types";

const MAX_COLLECTED = 10_000;
const MAPPABLE_FIELDS: ReadonlySet<string> = new Set([
  "externalRef", "title", "subject", "body", "cta", "deeplink", "imageUrl", "htmlBody", "tags", "updatedAt",
]);
const LOCALE_KEY = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

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
        if (Array.isArray(c)) {
          for (const el of c) {
            if (next.length >= MAX_COLLECTED) break;
            next.push(el);
          }
        }
        collecting = true;
      } else if (c !== null && typeof c === "object") {
        const key = Array.isArray(c) && /^\d+$/.test(t) ? Number(t) : t;
        // Own properties only: never walk into the prototype chain (constructor, __proto__).
        if (!Object.prototype.hasOwnProperty.call(c, key)) continue;
        const v = (c as Record<string | number, unknown>)[key];
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
    const map = v as Record<string, unknown>;
    const hasEnglish = Object.prototype.hasOwnProperty.call(map, "en-US") || Object.prototype.hasOwnProperty.call(map, "en");
    if (hasEnglish && entries.every(([k]) => LOCALE_KEY.test(k))) {
      const def = map["en-US"] ?? map.en;
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
  const refLabel = ref.slice(0, 200);
  const draft: Record<string, unknown> = { channel: defaults.channel, tags: [] };
  const locales: Record<string, Record<string, string>> = {};

  for (const [field, path] of Object.entries(mapping) as [keyof FieldMapping, string][]) {
    if (!MAPPABLE_FIELDS.has(field)) continue;
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
    return { error: `${refLabel}: invalid or missing ${fields}` };
  }
  return { item: parsed.data };
}
