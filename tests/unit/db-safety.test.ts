import { describe, expect, it } from "bun:test";
import {
  assertLocalDatabase,
  isLocalDatabaseUrl,
  shouldBlockPrismaCommand,
} from "@/lib/db-safety";

const NEON = "postgresql://neondb_owner:s3cretPassw0rd@ep-orange-star-b8ujtvot.us-east-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgresql://localhost:5432/nexus_test";

describe("isLocalDatabaseUrl", () => {
  it.each([
    "postgresql://localhost:5432/nexus_test",
    "postgres://localhost/nexus_test",
    "postgresql://user:pw@127.0.0.1:5432/db",
    "postgresql://[::1]:5432/db",
    "postgresql://LOCALHOST/db",
    "postgresql:///nexus_test?host=/var/run/postgresql",
    "postgresql://localhost/db?host=/tmp",
    "postgresql://localhost/db?hostaddr=127.0.0.1",
  ])("accepts %s", (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true);
  });

  it.each([
    NEON,
    "postgresql://ep-old-surf-a4p5os6s.us-east-2.aws.neon.tech/neondb",
    "postgresql://db.example.com/db",
    "postgresql://localhost/db?host=evil.example.com",
    "postgresql://localhost/db?host=/tmp&host=evil.example.com",
    "postgresql://localhost/db?hostaddr=1.2.3.4",
    "postgresql:///db",
    "postgresql://localhost,evil.example.com/db",
    "mysql://localhost/db",
    "localhost:5432/db",
    "not a url",
    "",
    undefined,
  ])("rejects %s", (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(false);
  });
});

describe("assertLocalDatabase", () => {
  it("does not throw for a local URL", () => {
    expect(() => assertLocalDatabase(LOCAL, "unit")).not.toThrow();
  });

  it("throws a SAFETY ABORT naming the context and host", () => {
    expect(() => assertLocalDatabase(NEON, "unit")).toThrow(
      "SAFETY ABORT (unit): refusing to use a non-local database (ep-orange-star-b8ujtvot.us-east-1.aws.neon.tech).",
    );
  });

  it("never includes credentials in the message", () => {
    let message = "";
    try {
      assertLocalDatabase(NEON, "unit");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("SAFETY ABORT");
    expect(message).not.toContain("s3cretPassw0rd");
    expect(message).not.toContain("neondb_owner");
  });

  it("names the remote host param when the authority is local", () => {
    expect(() => assertLocalDatabase("postgresql://localhost/db?host=evil.example.com", "unit")).toThrow(
      "(evil.example.com)",
    );
  });

  it("reports malformed and missing URLs as 'invalid url'", () => {
    expect(() => assertLocalDatabase("::::", "unit")).toThrow("(invalid url)");
    expect(() => assertLocalDatabase(undefined, "unit")).toThrow("(invalid url)");
  });
});

describe("shouldBlockPrismaCommand", () => {
  const bin = ["/usr/local/bin/node", "/repo/node_modules/prisma/build/index.js"];
  const argv = (...args: string[]) => [...bin, ...args];

  it.each([
    ["migrate", "dev"],
    ["migrate", "dev", "--name", "add_column"],
    ["migrate", "reset", "--force"],
    ["db", "push"],
    ["db", "push", "--accept-data-loss"],
    ["db", "execute", "--file", "x.sql"],
  ])("blocks %p against a live DB", (...args) => {
    expect(shouldBlockPrismaCommand(argv(...args), NEON, {})).toBe(true);
  });

  it("blocks destructive commands when the URL is missing or malformed", () => {
    expect(shouldBlockPrismaCommand(argv("migrate", "dev"), undefined, {})).toBe(true);
    expect(shouldBlockPrismaCommand(argv("db", "push"), "garbage", {})).toBe(true);
  });

  it("allows destructive commands against a live DB with the explicit override", () => {
    const env = { ALLOW_LIVE_DB_SCHEMA_CHANGE: "1" };
    expect(shouldBlockPrismaCommand(argv("migrate", "dev"), NEON, env)).toBe(false);
    expect(shouldBlockPrismaCommand(argv("migrate", "reset"), NEON, env)).toBe(false);
    expect(shouldBlockPrismaCommand(argv("db", "push"), NEON, env)).toBe(false);
  });

  it("does not treat other override values as consent", () => {
    expect(shouldBlockPrismaCommand(argv("db", "push"), NEON, { ALLOW_LIVE_DB_SCHEMA_CHANGE: "true" })).toBe(true);
  });

  it.each([
    ["generate"],
    ["migrate", "deploy"],
    ["migrate", "status"],
    ["studio"],
    ["db", "pull"],
    ["db", "push", "--help"],
    [],
  ])("allows %p against a live DB", (...args) => {
    expect(shouldBlockPrismaCommand(argv(...args), NEON, {})).toBe(false);
  });

  it.each([
    ["migrate", "dev"],
    ["migrate", "reset"],
    ["db", "push"],
    ["db", "execute"],
    ["generate"],
  ])("allows %p against localhost", (...args) => {
    expect(shouldBlockPrismaCommand(argv(...args), LOCAL, {})).toBe(false);
  });
});
