import { load as parseYaml } from "js-yaml";
import { normalizePushLocaleTag } from "@/lib/push-locale";
import type { ParsedFilename, ParsedCopy } from "./types";

const LANG_TOKEN = /^[a-z]{2,3}(_[a-z]{2,4})?$/i;

/**
 * Parse `<stem>-<lang>.{json,yml,yaml}` into { stem, canonical language }.
 * Splits on the LAST hyphen so hyphens inside the stem survive. Returns null when
 * the extension is unsupported, there is no hyphen, or the trailing token is not a
 * language code.
 */
export function parseFilename(relativePath: string): ParsedFilename | null {
  const base = relativePath.split("/").pop() ?? relativePath;
  const extMatch = base.match(/\.(json|ya?ml)$/i);
  if (!extMatch) return null;
  const nameNoExt = base.slice(0, base.length - extMatch[0].length);
  const lastDash = nameNoExt.lastIndexOf("-");
  if (lastDash <= 0) return null;
  const stem = nameNoExt.slice(0, lastDash);
  const langRaw = nameNoExt.slice(lastDash + 1);
  if (!LANG_TOKEN.test(langRaw)) return null;
  const norm = normalizePushLocaleTag(langRaw);
  if (!norm) return null;
  return { stem, language: norm.full };
}

export function fileKind(relativePath: string): "json" | "yml" | null {
  if (/\.json$/i.test(relativePath)) return "json";
  if (/\.ya?ml$/i.test(relativePath)) return "yml";
  return null;
}

/**
 * Map a translation file's contents to copy. body prefers push_message_non_personal
 * (tokenless — Nexus sends plain strings, no Liquid layer), falling back to
 * push_message_personal. Returns null when contents are unparseable or have no body.
 */
export function parseFileContents(contents: string, kind: "json" | "yml"): ParsedCopy | null {
  let obj: unknown;
  try {
    obj = kind === "json" ? JSON.parse(contents) : parseYaml(contents);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

  const title = str(rec.push_title);
  const nonPersonal = str(rec.push_message_non_personal);
  const personal = str(rec.push_message_personal);
  const body = nonPersonal ?? personal;
  if (!body) return null;
  return { title, body, bodyPersonal: personal };
}
