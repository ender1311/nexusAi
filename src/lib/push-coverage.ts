// Pure summary of a push variant's localization coverage. English always lives on
// the MessageVariant itself (there is no "en" translation row), so "coverage" counts
// the distinct non-English translation languages. No I/O.

export function countCoverageLanguages(languages: string[]): number {
  const distinct = new Set<string>();
  for (const raw of languages) {
    const lang = raw.trim();
    if (lang && lang.toLowerCase() !== "en") distinct.add(lang);
  }
  return distinct.size;
}

export function formatLanguageCoverage(languages: string[]): string {
  const n = countCoverageLanguages(languages);
  if (n === 0) return "EN only";
  if (n === 1) return "EN + 1 language";
  return `EN + ${n} languages`;
}
