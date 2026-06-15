// tests/integration/votd-content.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import {
  getVotdContent,
  prepareVotdContent,
  __resetVotdCalendarCacheForTests,
} from "@/lib/votd/votd-content";
import { votdContentKey } from "@/lib/votd/votd-user-key";

const realFetch = globalThis.fetch;
let fetchCalls: string[] = [];

function stubFetch(opts: { failVerse?: boolean; failImages?: boolean; failCalendar?: boolean } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes("moments.youversionapi.com")) {
      if (opts.failCalendar) return new Response("err", { status: 500 });
      return Response.json({
        votd: [
          { day: 1, usfm: ["GEN.1.1"] }, // no image_id → tests null-image path
          { day: 162, usfm: ["JHN.3.16"], image_id: 77058 },
        ],
      });
    }
    if (url.includes("bible.youversionapi.com")) {
      if (opts.failVerse) return new Response("err", { status: 500 });
      return Response.json({
        verses: [{ content: "For God so loved the world", reference: { human: "John 3:16" } }],
      });
    }
    if (url.includes("images.youversionapi.com")) {
      if (opts.failImages) return new Response("err", { status: 500 });
      return Response.json({ items: [{ urls: { regular: "//imgs.youversion.com/{w}x{h}/a.jpg" } }] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

beforeEach(async () => {
  await truncateAll();
  await prisma.votdDailyContent.deleteMany({});
  __resetVotdCalendarCacheForTests();
  fetchCalls = [];
});
afterEach(async () => {
  await prisma.votdDailyContent.deleteMany({});
  await truncateAll();
  globalThis.fetch = realFetch;
});

describe("getVotdContent", () => {
  it("cold miss fetches, writes a row, and returns content", async () => {
    stubFetch();
    const content = await getVotdContent(prisma, "2026-06-11", "en"); // day 162
    expect(content).not.toBeNull();
    expect(content!.reference).toBe("John 3:16");
    expect(content!.verseText).toBe("For God so loved the world");
    expect(content!.usfm).toBe("JHN.3.16");
    expect(content!.versionId).toBe(111);
    expect(content!.imageUrlIos).toBe("https://imgs.youversion.com/320x320/a.jpg");
    expect(content!.imageUrlAndroid).toBe("https://imgs.youversion.com/1024x512/a.jpg");
    const row = await prisma.votdDailyContent.findUnique({
      where: { date_languageTag: { date: "2026-06-11", languageTag: "en" } },
    });
    expect(row).not.toBeNull();
  });

  it("warm hit returns the cached row with zero fetches", async () => {
    await prisma.votdDailyContent.create({
      data: {
        date: "2026-06-11", languageTag: "en", usfm: "JHN.3.16",
        reference: "John 3:16", verseText: "cached", versionId: 111,
      },
    });
    globalThis.fetch = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
    const content = await getVotdContent(prisma, "2026-06-11", "en");
    expect(content!.verseText).toBe("cached");
  });

  it("image API failure stores NULL images (text-only), never a base/background image", async () => {
    // Verse images must be the prerendered (verse-text) card. The base/background
    // master art is NOT a verse image, so on prerendered-API failure we send
    // text-only rather than a background. (image_id 77058 is present but unused.)
    stubFetch({ failImages: true });
    const content = await getVotdContent(prisma, "2026-06-11", "en");
    expect(content!.imageUrlIos).toBeNull();
    expect(content!.imageUrlAndroid).toBeNull();
  });

  it("image API failure with no calendar image_id stores null image columns", async () => {
    stubFetch({ failImages: true });
    const content = await getVotdContent(prisma, "2026-01-01", "en"); // day 1 = GEN.1.1, no image_id
    expect(content).not.toBeNull();
    expect(content!.imageUrlIos).toBeNull();
    expect(content!.imageUrlAndroid).toBeNull();
  });

  it("verse fetch failure returns null and writes no row", async () => {
    stubFetch({ failVerse: true });
    const content = await getVotdContent(prisma, "2026-06-11", "en");
    expect(content).toBeNull();
    const count = await prisma.votdDailyContent.count();
    expect(count).toBe(0);
  });

  it("calendar failure returns null but a later call can retry (memo reset)", async () => {
    stubFetch({ failCalendar: true });
    expect(await getVotdContent(prisma, "2026-06-11", "en")).toBeNull();
    stubFetch(); // now healthy
    expect(await getVotdContent(prisma, "2026-06-11", "en")).not.toBeNull();
  });
});

describe("prepareVotdContent", () => {
  it("dedupes (date, language) pairs and ignores non-VOTD variants", async () => {
    stubFetch();
    const at = new Date("2026-06-11T15:00:00Z");
    const inputs = [
      { user: { attributes: { language_tag: "en", timezone: "America/Chicago" } }, variantId: "v1", scheduledAt: at },
      { user: { attributes: { language_tag: "en", timezone: "America/Chicago" } }, variantId: "v1", scheduledAt: at },
      { user: { attributes: { language_tag: "en", timezone: "America/Chicago" } }, variantId: "vX", scheduledAt: at },
    ];
    const map = await prepareVotdContent(prisma, inputs, new Set(["v1"]));
    expect(map.size).toBe(1);
    expect(map.get(votdContentKey("2026-06-11", "en"))!.reference).toBe("John 3:16");
    // one calendar + one verse + one images fetch — duplicates deduped, vX ignored
    expect(fetchCalls.length).toBe(3);
  });

  it("isolates a failing language — other (date, lang) pairs still resolve", async () => {
    // es (version 149) verse fetch fails; en (version 111) succeeds.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      if (url.includes("moments.youversionapi.com")) {
        return Response.json({ votd: [{ day: 162, usfm: ["JHN.3.16"], image_id: 77058 }] });
      }
      if (url.includes("bible.youversionapi.com")) {
        if (url.includes("id=149")) return new Response("err", { status: 500 });
        return Response.json({
          verses: [{ content: "For God so loved the world", reference: { human: "John 3:16" } }],
        });
      }
      if (url.includes("images.youversionapi.com")) {
        return Response.json({ items: [{ urls: { regular: "//imgs.youversion.com/{w}x{h}/a.jpg" } }] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const at = new Date("2026-06-11T15:00:00Z");
    const inputs = [
      { user: { attributes: { language_tag: "en", timezone: "America/Chicago" } }, variantId: "v1", scheduledAt: at },
      { user: { attributes: { language_tag: "es", timezone: "America/Chicago" } }, variantId: "v1", scheduledAt: at },
    ];
    const map = await prepareVotdContent(prisma, inputs, new Set(["v1"]));
    expect(map.has(votdContentKey("2026-06-11", "en"))).toBe(true);
    expect(map.has(votdContentKey("2026-06-11", "es"))).toBe(false);
  });

  it("returns an empty map when no VOTD variants exist (zero fetches)", async () => {
    globalThis.fetch = (async () => { throw new Error("must not fetch"); }) as unknown as typeof fetch;
    const map = await prepareVotdContent(prisma, [], new Set());
    expect(map.size).toBe(0);
  });
});
