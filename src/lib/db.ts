import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

function createPrismaClient() {
  const rawUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  // libsql expects file: URLs (same as SQLite)
  const url = rawUrl.startsWith("file:") ? rawUrl : `file:${rawUrl}`;

  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
