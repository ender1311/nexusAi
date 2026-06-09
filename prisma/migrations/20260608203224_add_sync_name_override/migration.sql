CREATE TABLE IF NOT EXISTS "SyncNameOverride" (
  "syncId"      TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncNameOverride_pkey" PRIMARY KEY ("syncId")
);

INSERT INTO "SyncNameOverride" ("syncId", "displayName", "updatedAt", "createdAt")
VALUES ('2770929', 'Push Opens', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("syncId") DO NOTHING;
