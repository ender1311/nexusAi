import { parseFilename, parseFileContents, fileKind } from "./parse";
import type { ImportFile, GroupedPush } from "./types";

export type SkippedFile = { relativePath: string; reason: string };

/**
 * Group a flat list of files into one GroupedPush per stem. Files that aren't
 * `<stem>-<lang>.{json,yml}` or whose contents don't parse are reported as skipped.
 */
export function groupImportFiles(files: ImportFile[]): { groups: GroupedPush[]; skipped: SkippedFile[] } {
  const byStem = new Map<string, GroupedPush>();
  const skipped: SkippedFile[] = [];

  for (const file of files) {
    const parsed = parseFilename(file.relativePath);
    if (!parsed) {
      skipped.push({ relativePath: file.relativePath, reason: "not a <stem>-<lang> translation file" });
      continue;
    }
    const kind = fileKind(file.relativePath);
    if (!kind) {
      skipped.push({ relativePath: file.relativePath, reason: "unsupported extension" });
      continue;
    }
    const copy = parseFileContents(file.contents, kind);
    if (!copy) {
      skipped.push({ relativePath: file.relativePath, reason: "unparseable or empty body" });
      continue;
    }
    let group = byStem.get(parsed.stem);
    if (!group) {
      group = { stem: parsed.stem, byLang: new Map() };
      byStem.set(parsed.stem, group);
    }
    group.byLang.set(parsed.language, copy); // last write wins on duplicate (stem, lang)
  }

  return { groups: [...byStem.values()], skipped };
}
