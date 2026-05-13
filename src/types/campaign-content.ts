export type CampaignContentRow = {
  id: string;
  campaign: string;
  contentType: string;
  language: string;
  usfmReference: string;
  usfmHuman: string | null;
  title: string | null;
  body: string | null;
  status: string;
};

export type ContentEntry = { id: string; text: string };

export type VerseRow = {
  usfmReference: string;
  usfmHuman: string;
  sortKey: number;
  aTitle: ContentEntry | null;
  bTitle: ContentEntry | null;
  verseText: ContentEntry | null;
};

export type LangSummary = {
  language: string;
  total: number;
  expected: number;
  hasGaps: boolean;
};

export type GapItem = {
  usfmReference: string;
  usfmHuman: string;
  contentType: "a-title" | "b-title" | "verse-text";
  englishText: string | null;
};
