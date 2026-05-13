import { describe, expect, it } from "bun:test";
import { usfmToHuman, usfmSortKey, BOOK_ORDER } from "@/lib/usfm";

describe("usfmToHuman", () => {
  it("single verse: GEN.1.1", () => {
    expect(usfmToHuman("GEN.1.1")).toBe("Genesis 1:1");
  });

  it("single verse: 2CO.4.16", () => {
    expect(usfmToHuman("2CO.4.16")).toBe("2 Corinthians 4:16");
  });

  it("multi-verse same chapter: ISA.43.18+ISA.43.19", () => {
    expect(usfmToHuman("ISA.43.18+ISA.43.19")).toBe("Isaiah 43:18–19");
  });

  it("multi-verse same chapter: PSA.8.3+PSA.8.4", () => {
    expect(usfmToHuman("PSA.8.3+PSA.8.4")).toBe("Psalm 8:3–4");
  });

  it("cross-chapter: MAT.5.3+MAT.6.1", () => {
    expect(usfmToHuman("MAT.5.3+MAT.6.1")).toBe("Matthew 5:3–6:1");
  });

  it("Psalm alias: PSA.134.1", () => {
    expect(usfmToHuman("PSA.134.1")).toBe("Psalm 134:1");
  });

  it("Song of Songs alias: SNG.1.2", () => {
    expect(usfmToHuman("SNG.1.2")).toBe("Song of Songs 1:2");
  });

  it("Philemon: PHM.1.6", () => {
    expect(usfmToHuman("PHM.1.6")).toBe("Philemon 1:6");
  });

  it("PHP (Philippians): PHP.1.6", () => {
    expect(usfmToHuman("PHP.1.6")).toBe("Philippians 1:6");
  });

  it("REV (last book): REV.22.21", () => {
    expect(usfmToHuman("REV.22.21")).toBe("Revelation 22:21");
  });

  it("unknown book code: returns raw string", () => {
    expect(usfmToHuman("ZZZ.1.1")).toBe("ZZZ.1.1");
  });
});

describe("usfmSortKey", () => {
  it("GEN.1.1 < GEN.1.2", () => {
    expect(usfmSortKey("GEN.1.1")).toBeLessThan(usfmSortKey("GEN.1.2"));
  });

  it("GEN.1.1 < GEN.2.1", () => {
    expect(usfmSortKey("GEN.1.1")).toBeLessThan(usfmSortKey("GEN.2.1"));
  });

  it("GEN < EXO (canonical order)", () => {
    expect(usfmSortKey("GEN.50.26")).toBeLessThan(usfmSortKey("EXO.1.1"));
  });

  it("REV is the last book", () => {
    expect(usfmSortKey("JUD.25.1")).toBeLessThan(usfmSortKey("REV.1.1"));
  });

  it("multi-verse: uses first verse for sort", () => {
    expect(usfmSortKey("ISA.43.18+ISA.43.19")).toBe(usfmSortKey("ISA.43.18"));
  });
});

describe("BOOK_ORDER", () => {
  it("GEN is book 1", () => {
    expect(BOOK_ORDER["GEN"]).toBe(1);
  });

  it("REV is book 66", () => {
    expect(BOOK_ORDER["REV"]).toBe(66);
  });

  it("PSA is book 19", () => {
    expect(BOOK_ORDER["PSA"]).toBe(19);
  });
});
