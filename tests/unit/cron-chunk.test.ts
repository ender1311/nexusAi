// Unit tests for chunk() / runChunked() — the batching helper that bounds the
// fan-out of parallel DB writes in the select-and-send cron run.

import { describe, expect, it } from "bun:test";
import { chunk, runChunked } from "@/lib/cron/chunk";

describe("chunk", () => {
  it("splits into consecutive batches of at most `size`", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single batch when size >= length", () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("returns no batches for an empty array", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("produces exact-fit batches with no trailing empty batch", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("throws on a size below 1", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("runChunked", () => {
  it("runs fn over every item and preserves order", async () => {
    const result = await runChunked([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds `size` concurrent in-flight promises", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runChunked(Array.from({ length: 10 }, (_, i) => i), 3, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return i;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("returns an empty array for no items", async () => {
    expect(await runChunked([], 4, async (x) => x)).toEqual([]);
  });
});
