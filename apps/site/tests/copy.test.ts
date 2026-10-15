// Pins the spec's copy rules: verbatim offer, no YouVersion, no named competitor.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { COPY } from "@site/content/copy";
import { publicConfig } from "@site/lib/public-config";

function allSiteText(dir: string): string {
  return readdirSync(dir).map((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" || f === ".next" || f === "tests" ? "" : allSiteText(p);
    return /\.(tsx?|css)$/.test(f) ? readFileSync(p, "utf8") : "";
  }).join("\n");
}

describe("site copy", () => {
  it("carries the verbatim offer lines", () => {
    expect(COPY.offer.terms).toBe("5 spots. 90-day pilot, free. One agent, holdout reports at day 30/60/90. In exchange: a case study and feedback.");
    expect(COPY.offer.after).toBe("After the pilot: from $1.5k/mo per agent, or pay on measured lift.");
  });

  it("never names YouVersion or a competitor, and never prices one", () => {
    const text = allSiteText(path.join(import.meta.dir, ".."));
    for (const banned of [/youversion/i, /bible/i, /39\s?m/i, /decisioning studio/i, /offerfit/i, /\$300k/i]) {
      expect(text).not.toMatch(banned);
    }
  });

  it("makes no claim that isn't true today, anywhere in the site source", () => {
    const text = allSiteText(path.join(import.meta.dir, ".."));
    for (const banned of [/any (cdp|warehouse|esp)/i, /without decisioning/i, /why it was made/i, /copies only the fields you map/i, /plugs into/i, /every decision explained/i]) {
      expect(text).not.toMatch(banned);
    }
    const selfHost = COPY.faq.find((f) => /self-host/i.test(f.q));
    expect(selfHost?.a).not.toMatch(/^yes/i);
  });

  it("keeps the demo console link hidden", () => {
    expect(publicConfig.showConsoleLink).toBe(false);
  });
});
