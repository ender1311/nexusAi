-- apps/site/db/001_design_partner_lead.sql
-- Design-partner leads from beaconfrontier.com/nexus. Idempotent; apply with psql.
CREATE TABLE IF NOT EXISTS "DesignPartnerLead" (
  "id"        TEXT PRIMARY KEY,
  "email"     TEXT NOT NULL,
  "company"   TEXT NOT NULL,
  "source"    TEXT NOT NULL,
  "sender"    TEXT NOT NULL,
  "useCase"   TEXT NOT NULL,
  "ipHash"    TEXT NOT NULL,
  "userAgent" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "DesignPartnerLead_ipHash_createdAt_idx" ON "DesignPartnerLead" ("ipHash", "createdAt");
