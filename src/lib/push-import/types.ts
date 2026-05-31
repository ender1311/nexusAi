// Shared types for the push-translation importer. The parse/group/plan stages are
// pure; only commit touches the DB.

export type ParsedFilename = { stem: string; language: string };

export type ParsedCopy = { title: string | null; body: string; bodyPersonal: string | null };

export type ImportFile = { relativePath: string; contents: string };

/** One logical push (all languages for a single stem). */
export type GroupedPush = {
  stem: string;
  byLang: Map<string, ParsedCopy>; // canonical lang code → copy (includes "en" anchor)
};

export type PerLanguagePlan = {
  language: string;       // canonical code
  action: "create" | "update" | "noop";
  title: string | null;
  body: string;
  bodyPersonal: string | null;
};

export type StemPlan =
  | {
      stem: string;
      matched: true;
      messageVariantId: string;
      variantName: string;
      languages: PerLanguagePlan[];
      englishDivergence: { incoming: string; current: string } | null; // body diff vs variant.body
    }
  | {
      stem: string;
      matched: false;
      languages: string[]; // languages present for the unmatched stem (informational)
    };

export type ImportPlan = {
  matched: Extract<StemPlan, { matched: true }>[];
  unmatched: Extract<StemPlan, { matched: false }>[];
  totals: { stems: number; matchedStems: number; unmatchedStems: number; creates: number; updates: number; noops: number };
};
