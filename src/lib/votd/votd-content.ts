// src/lib/votd/votd-content.ts
import { buildVerseImageUrls } from "@/lib/verse-image";
import { versionForLanguage } from "./version-map";
import { resolveVotdUserKey, votdContentKey } from "./votd-user-key";

export type VotdContent = {
  date: string;
  languageTag: string;
  usfm: string;
  reference: string;
  verseText: string;
  versionId: number;
  imageUrlIos: string | null;
  imageUrlAndroid: string | null;
};

type PrismaLike = typeof import("@/lib/db").prisma;

const VOTD_HEADERS = {
  Referer: "http://yvapi.youversionapi.com",
  "X-YouVersion-Client": "youversion",
  "X-YouVersion-App-Platform": "internal",
  "X-YouVersion-App-Version": "1",
} as const;

type VotdCalendarEntry = { day: number; usfm: string[]; image_id?: number | string };

// 365-entry static calendar, memoized per process. Reset on failure so a
// transient error doesn't poison every later call.
let calendarPromise: Promise<VotdCalendarEntry[]> | null = null;

export function __resetVotdCalendarCacheForTests(): void {
  calendarPromise = null;
}

async function loadVotdCalendar(): Promise<VotdCalendarEntry[]> {
  if (!calendarPromise) {
    calendarPromise = (async () => {
      try {
        const res = await fetch(
          "https://moments.youversionapi.com/3.1/votd.json?type=standard&language_tag=en",
          { headers: VOTD_HEADERS },
        );
        if (!res.ok) throw new Error(`votd.json HTTP ${res.status}`);
        const json = (await res.json()) as {
          votd?: VotdCalendarEntry[];
          response?: { data?: VotdCalendarEntry[] };
        };
        // API changed from { votd: [...] } to { response: { data: [...] } }
        const entries = json.response?.data ?? json.votd;
        if (!Array.isArray(entries) || entries.length === 0) {
          throw new Error("votd.json: empty calendar");
        }
        return entries;
      } catch (err) {
        calendarPromise = null;
        throw err;
      }
    })();
  }
  return calendarPromise;
}

/** Day-of-year (1–366) for a "YYYY-MM-DD" string, computed in UTC. */
export function dayOfYear(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

/** Render an images-API URL template ({w}x{h} or {width}x{height} placeholders);
 *  protocol-relative URLs get an https: prefix. */
export function renderImageUrl(template: string, w: number, h: number): string {
  const url = template
    .replaceAll("{w}", String(w))
    .replaceAll("{h}", String(h))
    .replaceAll("{width}", String(w))
    .replaceAll("{height}", String(h));
  return url.startsWith("//") ? `https:${url}` : url;
}

async function fetchVerse(
  usfms: string[],
  versionId: number,
): Promise<{ reference: string; verseText: string } | null> {
  const refs = usfms.map((u) => `references[]=${encodeURIComponent(u)}`).join("&");
  const res = await fetch(
    `https://bible.youversionapi.com/3.1/verses.json?${refs}&id=${versionId}&format=text`,
    { headers: VOTD_HEADERS },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    verses?: Array<{ content?: string; reference?: { human?: string } }>;
    response?: { data?: { verses?: Array<{ content?: string; reference?: { human?: string } }> } };
  };
  // API changed from { verses: [...] } to { response: { data: { verses: [...] } } }
  const verses = json.response?.data?.verses ?? json.verses ?? [];
  const reference = verses.map((v) => v.reference?.human).filter(Boolean).join("; ");
  const verseText = verses.map((v) => (v.content ?? "").trim()).filter(Boolean).join(" ");
  if (!reference || !verseText) return null;
  return { reference, verseText };
}

async function fetchImageUrls(
  usfm: string,
  languageTag: string,
  fallbackImageId: string | null,
): Promise<{ ios: string | null; android: string | null }> {
  try {
    const res = await fetch(
      `https://images.youversionapi.com/3.2/items.json?usfm[]=${encodeURIComponent(usfm)}&language_tag=${encodeURIComponent(languageTag)}&category=prerendered`,
      { headers: VOTD_HEADERS },
    );
    if (res.ok) {
      const json = (await res.json()) as {
        items?: Array<{ urls?: { regular?: string } }>;
        response?: { data?: { images?: Array<{ urls?: { regular?: string } }> } };
      };
      // API changed from { items: [...] } to { response: { data: { images: [...] } } }
      const items = json.response?.data?.images ?? json.items;
      const template = items?.[0]?.urls?.regular;
      if (template) {
        return {
          ios: renderImageUrl(template, 320, 320),
          android: renderImageUrl(template, 1024, 512),
        };
      }
    }
  } catch { /* image failure is non-fatal — text-only sends still work */ }
  if (fallbackImageId) {
    const { ios, android } = buildVerseImageUrls(fallbackImageId);
    return { ios, android };
  }
  return { ios: null, android: null };
}

/** Cached VOTD content for a user-local date + content language.
 *  DB hit → return; miss → fetch calendar/verse/images, upsert, return.
 *  Any text-path failure → null (caller must skip the user — never send raw tags). */
export async function getVotdContent(
  prisma: PrismaLike,
  date: string,
  languageTag: string,
): Promise<VotdContent | null> {
  const existing = await prisma.votdDailyContent.findUnique({
    where: { date_languageTag: { date, languageTag } },
  });
  if (existing) return existing;

  try {
    const calendar = await loadVotdCalendar();
    const doy = dayOfYear(date);
    // Day 366 (leap-year Dec 31) has no calendar entry → reuse day 365.
    const entry = calendar.find((e) => e.day === doy) ?? calendar.find((e) => e.day === 365);
    if (!entry || !Array.isArray(entry.usfm) || entry.usfm.length === 0) return null;

    const versionId = versionForLanguage(languageTag);
    const verse = await fetchVerse(entry.usfm, versionId);
    if (!verse) return null;

    const images = await fetchImageUrls(
      entry.usfm[0],
      languageTag,
      entry.image_id != null ? String(entry.image_id) : null,
    );

    // @@unique([date, languageTag]) makes concurrent misses safe.
    return await prisma.votdDailyContent.upsert({
      where: { date_languageTag: { date, languageTag } },
      create: {
        date,
        languageTag,
        usfm: entry.usfm.join("+"),
        reference: verse.reference,
        verseText: verse.verseText,
        versionId,
        imageUrlIos: images.ios,
        imageUrlAndroid: images.android,
      },
      update: {},
    });
  } catch (err) {
    console.error("[votd] getVotdContent failed:", date, languageTag, err);
    return null;
  }
}

/** Cron-side pre-fetch: collect the unique (date, language) pairs for users
 *  assigned to VOTD variants, resolve each via getVotdContent, and return a
 *  map keyed by votdContentKey for the pure grouping pass. Unresolvable pairs
 *  are simply absent (those users get skipped). */
export async function prepareVotdContent(
  prisma: PrismaLike,
  inputs: Array<{ user: { attributes: unknown }; variantId: string; scheduledAt: Date }>,
  votdVariantIds: Set<string>,
): Promise<Map<string, VotdContent>> {
  const out = new Map<string, VotdContent>();
  if (votdVariantIds.size === 0) return out;

  const pending = new Map<string, { date: string; languageTag: string }>();
  for (const input of inputs) {
    if (!votdVariantIds.has(input.variantId)) continue;
    const key = resolveVotdUserKey(input.user.attributes, input.scheduledAt);
    pending.set(votdContentKey(key.date, key.languageTag), key);
  }

  for (const [key, { date, languageTag }] of pending) {
    const content = await getVotdContent(prisma, date, languageTag);
    if (content) out.set(key, content);
  }
  return out;
}
