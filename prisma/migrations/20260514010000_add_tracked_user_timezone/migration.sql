-- AlterTable: add timezone column to TrackedUser (mapped to "User" table)
ALTER TABLE "User" ADD COLUMN "timezone" TEXT;
