-- Backfill lapsed_dau → lapsed_dau4
-- The Hightouch alias "lapsed_dau" was normalized to "lapsed_dau4" on ingest
-- but any records created before that normalization still hold the old value.
UPDATE "Agent"       SET "funnelStage" = 'lapsed_dau4' WHERE "funnelStage" = 'lapsed_dau';
UPDATE "User"        SET "funnelStage" = 'lapsed_dau4' WHERE "funnelStage" = 'lapsed_dau';
