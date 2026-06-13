// Guided Prayer daily content — fetched from guidedprayers.youversionapi.com 4.0.
// No auth required for production API. GUIDED_PRAYER_API_KEY is optional (Bearer token)
// if the API ever adds auth requirements. Returns null gracefully on any failure.
import { dayOfYear } from "./votd-content";
import { resolveVotdUserKey } from "./votd-user-key";

const GP_BASE = "https://guidedprayers.youversionapi.com/4.0";
const DEFAULT_GUIDE_ID = 1;
// English NIV (111) — guide 1 is English-only
const GP_VERSION_ID = 111;

const GP_HEADERS: Record<string, string> = {
  Referer: "http://yvapi.youversionapi.com",
  "X-YouVersion-Client": "youversion",
  "X-YouVersion-App-Platform": "ios",
  "X-YouVersion-App-Version": "122",
  // Node.js fetch sends no User-Agent by default; the GP API returns 404 without one.
  "User-Agent": "yv api script",
  Accept: "application/json",
  "Accept-Language": "en",
};

export type GpContent = {
  date: string;
  usfm: string;
  reference: string;
  verseText: string;
  imageUrl: string | null;
};

/** Build a platform-specific GP image URL by substituting dimensions into the proxy template.
 *  Template looks like: //imageproxy.youversionapi.com/{width}x{height}/https://... */
export function buildGpImageUrl(template: string, w: number, h: number): string {
  return template
    .replace("{width}x{height}", `${w}x${h}`)
    .replace(/^\/\//, "https://");
}

/** Per-platform GP image URLs: 320x320 for iOS, 1024x512 for Android. Null if no template. */
export function buildGpImageUrls(imageUrl: string | null): { ios: string | null; android: string | null } {
  if (!imageUrl) return { ios: null, android: null };
  return {
    ios: buildGpImageUrl(imageUrl, 320, 320),
    android: buildGpImageUrl(imageUrl, 1024, 512),
  };
}

type PrismaLike = typeof import("@/lib/db").prisma;

function buildHeaders(): Record<string, string> {
  const h = { ...GP_HEADERS };
  const key = process.env.GUIDED_PRAYER_API_KEY;
  if (key) h["Authorization"] = `Bearer ${key}`;
  return h;
}

/** Fetch the morning image URL template for a day-of-year. Returns null on any failure. */
async function fetchGpDayImage(doy: number): Promise<string | null> {
  try {
    const res = await fetch(
      `${GP_BASE}/guides/${DEFAULT_GUIDE_ID}/days/${doy}`,
      { headers: buildHeaders() },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;
    const images = data.images;
    if (Array.isArray(images)) {
      const morning = images.find(
        (img): img is Record<string, unknown> =>
          img && typeof img === "object" && (img as Record<string, unknown>).slug === "morning",
      );
      const morningUrl = morning?.url;
      if (typeof morningUrl === "string" && morningUrl) return morningUrl;
    }
    const fallback = data.image_url;
    return typeof fallback === "string" && fallback ? fallback : null;
  } catch {
    return null;
  }
}

/** Fetch the first usfm_text module reference for a day-of-year. Returns null on any failure. */
async function fetchGpUsfm(doy: number): Promise<string | null> {
  try {
    const res = await fetch(
      `${GP_BASE}/guides/${DEFAULT_GUIDE_ID}/days/${doy}/modules`,
      { headers: buildHeaders() },
    );
    if (!res.ok) {
      console.error(`[guided-prayer] modules HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as unknown;
    // Unwrap YV response envelope: { response: { data: [...] } } | [...] | { data: [...] }
    let modules: unknown[];
    if (Array.isArray(json)) {
      modules = json;
    } else if (json && typeof json === "object") {
      const j = json as Record<string, unknown>;
      const inner = j.response && typeof j.response === "object"
        ? (j.response as Record<string, unknown>).data
        : j.data;
      modules = Array.isArray(inner) ? inner : [];
    } else {
      modules = [];
    }

    for (const m of modules) {
      if (!m || typeof m !== "object") continue;
      const mod = m as Record<string, unknown>;
      // API uses _type (underscore prefix) per docs; fall back to kind/type for resilience
      const kind = mod._type ?? mod.kind ?? mod.type ?? mod.module_type;
      if (kind !== "usfm_text") continue;
      const refs = mod.references ?? mod.reference ?? mod.usfm;
      if (Array.isArray(refs) && typeof refs[0] === "string") return refs[0];
      if (typeof refs === "string" && refs) return refs;
    }
    console.warn("[guided-prayer] no usfm_text module found for day", doy);
    return null;
  } catch (err) {
    console.error("[guided-prayer] fetchGpUsfm failed:", err);
    return null;
  }
}

/** Fetch verse text for a USFM reference from the YouVersion Bible API. */
async function fetchGpVerse(usfm: string): Promise<{ reference: string; verseText: string } | null> {
  try {
    const res = await fetch(
      `https://bible.youversionapi.com/3.1/verses.json?references[]=${encodeURIComponent(usfm)}&id=${GP_VERSION_ID}&format=text`,
      { headers: GP_HEADERS },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      verses?: Array<{ content?: string; reference?: { human?: string } }>;
      response?: { data?: { verses?: Array<{ content?: string; reference?: { human?: string } }> } };
    };
    const verses = json.response?.data?.verses ?? json.verses ?? [];
    const reference = verses.map((v) => v.reference?.human).filter(Boolean).join("; ");
    const verseText = verses.map((v) => (v.content ?? "").trim()).filter(Boolean).join(" ");
    if (!reference || !verseText) return null;
    return { reference, verseText };
  } catch {
    return null;
  }
}

/** Cached Guided Prayer content for a UTC calendar date.
 *  DB hit → return; miss → fetch modules + verse, upsert, return.
 *  Any failure → null (caller must skip GP users — never send raw tags). */
export async function getGpContent(
  prisma: PrismaLike,
  date: string,
): Promise<GpContent | null> {
  const cached = await prisma.guidedPrayerDailyContent.findUnique({ where: { date } });
  if (cached) return cached;

  const doy = dayOfYear(date);
  const [usfm, imageUrl] = await Promise.all([fetchGpUsfm(doy), fetchGpDayImage(doy)]);
  if (!usfm) return null;

  const verse = await fetchGpVerse(usfm);
  if (!verse) return null;

  try {
    return await prisma.guidedPrayerDailyContent.upsert({
      where: { date },
      create: { date, usfm, reference: verse.reference, verseText: verse.verseText, imageUrl },
      update: {},
    });
  } catch (err) {
    console.error("[guided-prayer] upsert failed:", date, err);
    return null;
  }
}

/** Cron-side pre-fetch: collect the unique user-local dates for GP variant users,
 *  resolve each via getGpContent, return a map keyed by user-local date string.
 *  Unresolvable dates are absent (those users get skipped). */
export async function prepareGpContent(
  prisma: PrismaLike,
  inputs: Array<{ user: { attributes: unknown }; variantId: string; scheduledAt: Date }>,
  gpVariantIds: Set<string>,
): Promise<Map<string, GpContent>> {
  const out = new Map<string, GpContent>();
  if (gpVariantIds.size === 0) return out;

  const dates = new Set<string>();
  for (const input of inputs) {
    if (!gpVariantIds.has(input.variantId)) continue;
    const { date } = resolveVotdUserKey(input.user.attributes, input.scheduledAt);
    dates.add(date);
  }

  // allSettled: a transient API failure for one date never aborts the rest.
  const results = await Promise.allSettled(
    Array.from(dates).map(async (date) => {
      const content = await getGpContent(prisma, date);
      if (content) out.set(date, content);
    }),
  );
  for (const r of results) {
    if (r.status === "rejected") console.error("[guided-prayer] prepareGpContent fetch threw:", r.reason);
  }
  return out;
}
