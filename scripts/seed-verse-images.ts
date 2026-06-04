// Seed the curated USFM → image_id map into CampaignContent as contentType:"image"
// for the resurrection-push verse pool. Dry-run by default; pass --commit.
// prisma here targets .env.local (production) per CLAUDE.md — review the dry run.
import { prisma } from "@/lib/db";
import { usfmToHuman } from "@/lib/usfm";

const CAMPAIGN = "resurrection-push";

// Curated map from the Braze Resurrection Canvas liquid (deterministic, on-brand).
const VERSE_IMAGE_IDS: Record<string, number> = {
  "1CO.13.4": 79064,
  "1CO.3.16": 82877,
  "1CO.3.7": 97460,
  "1JN.1.9": 98384,
  "1JN.2.6": 113693,
  "1JN.3.16": 78243,
  "1JN.4.9": 86002,
  "1PE.3.15": 95231,
  "1PE.4.8": 56511,
  "1PE.5.8": 88791,
  "2CO.12.9": 58404,
  "2CO.3.17": 94253,
  "2CO.5.18": 91310,
  "2CO.5.21": 97917,
  "2CO.9.7": 84274,
  "2TI.1.7": 87968,
  "ACT.1.8": 81965,
  "ACT.10.43": 98380,
  "ACT.2.38": 71812,
  "ACT.4.12": 51164,
  "ACT.4.31": 110090,
  "AMO.5.24": 91942,
  "COL.3.2": 91354,
  "EPH.2.10": 98382,
  "EPH.2.8": 25568,
  "EZK.36.26": 52766,
  "GAL.5.16": 81966,
  "GAL.5.25": 60133,
  "HEB.12.2": 56520,
  "ISA.1.17": 106546,
  "ISA.12.2": 67209,
  "ISA.43.2": 37578,
  "ISA.53.5": 80556,
  "ISA.53.6": 81632,
  "ISA.55.6": 68506,
  "JAS.1.5": 106624,
  "JAS.4.7": 13741,
  "JHN.1.12": 113708,
  "JHN.15.12": 112538,
  "JHN.15.2": 46344,
  "JHN.16.13": 89267,
  "JHN.16.33": 110327,
  "JHN.20.21": 71804,
  "JHN.3.16": 77058,
  "JHN.3.17": 46025,
  "JHN.5.24": 46358,
  "JHN.8.12": 110600,
  "LUK.6.28": 91943,
  "MAT.10.20": 113690,
  "MAT.16.24": 112156,
  "MAT.28.19": 67133,
  "MAT.28.6": 101963,
  "MAT.5.10": 94010,
  "MAT.5.14": 424,
  "MAT.5.16": 44251,
  "MAT.5.3": 81643,
  "MAT.5.4": 92875,
  "MAT.5.5": 92880,
  "MAT.5.6": 92876,
  "MAT.5.7": 92879,
  "MAT.5.8": 92881,
  "MAT.5.9": 92884,
  "MAT.6.33": 91314,
  "MAT.9.37": 81648,
  "MIC.6.8": 61799,
  "MRK.13.33": 97470,
  "MRK.16.15": 94047,
  "PHP.2.5": 94045,
  "PRO.13.20": 46032,
  "PRO.29.25": 72140,
  "PRO.9.10": 100136,
  "PSA.103.13": 58425,
  "PSA.139.14": 68525,
  "PSA.145.18": 23025,
  "PSA.23.3": 39665,
  "PSA.27.14": 112517,
  "PSA.32.8": 17238,
  "PSA.34.18": 72329,
  "PSA.4.8": 88784,
  "PSA.42.11": 52780,
  "ROM.1.16": 98397,
  "ROM.1.17": 112545,
  "ROM.10.13": 110599,
  "ROM.10.14": 101978,
  "ROM.10.17": 98400,
  "ROM.10.9": 113711,
  "ROM.3.23": 104846,
  "ROM.5.8": 112155,
  "ROM.8.18": 46359,
  "ROM.8.31": 83999,
  "ZEC.14.9": 2628,
};

async function main() {
  const doCommit = process.argv.includes("--commit");
  const entries = Object.entries(VERSE_IMAGE_IDS);
  console.log(`Seed verse images — ${doCommit ? "COMMIT" : "DRY RUN"} — ${entries.length} verses`);
  for (const [usfm, id] of entries.slice(0, 5)) {
    console.log(`  ${usfm.padEnd(12)} → image_id ${id} (${usfmToHuman(usfm)})`);
  }
  console.log(`  … and ${entries.length - 5} more`);
  if (!doCommit) { console.log("\nDRY RUN — nothing written. Re-run with --commit."); return; }

  const rows = entries.map(([usfmReference, imageId]) => ({
    campaign: CAMPAIGN,
    contentType: "image",
    language: "en",
    usfmReference,
    usfmHuman: usfmToHuman(usfmReference),
    title: null,
    body: String(imageId),
  }));
  const result = await prisma.campaignContent.createMany({ data: rows, skipDuplicates: true });
  console.log(`\nInserted ${result.count} new image rows (skipped ${rows.length - result.count} existing).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
