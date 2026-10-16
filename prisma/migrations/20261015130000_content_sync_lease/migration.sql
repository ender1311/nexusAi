-- Lease for content sync: at most one 'running' row per source.
CREATE UNIQUE INDEX IF NOT EXISTS "ContentSyncRun_one_running_per_source" ON "ContentSyncRun" ("source") WHERE "status" = 'running';
