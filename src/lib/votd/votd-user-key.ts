// src/lib/votd/votd-user-key.ts
import { userLocalDate } from "./local-date";
import { contentLanguageFor } from "./version-map";

export type VotdUserKey = { date: string; languageTag: string };

/** Map key for a (date, language) content row. Neither part can contain a space. */
export function votdContentKey(date: string, languageTag: string): string {
  return `${date} ${languageTag}`;
}

function parseAttributes(attributes: unknown): Record<string, unknown> {
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    return attributes as Record<string, unknown>;
  }
  if (typeof attributes === "string") {
    try {
      const parsed: unknown = JSON.parse(attributes);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* fall through to {} */ }
  }
  return {};
}

/** Shared per-user VOTD resolution: local calendar date (timezone attr,
 *  Chicago fallback) + content language (language_tag attr, en fallback).
 *  Used by send-grouping, prepareVotdContent, and demo/send — keep single. */
export function resolveVotdUserKey(attributes: unknown, at: Date): VotdUserKey {
  const attrs = parseAttributes(attributes);
  const timezone = typeof attrs.timezone === "string" ? attrs.timezone : null;
  const langRaw = typeof attrs.language_tag === "string" ? attrs.language_tag : null;
  return {
    date: userLocalDate(timezone, at),
    languageTag: contentLanguageFor(langRaw),
  };
}
