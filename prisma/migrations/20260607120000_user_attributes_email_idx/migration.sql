-- Expression index for exact email lookup on the User.attributes JSON column.
-- Prisma's JSON-path filter does not reliably use this index, so /api/users/search
-- queries it via $queryRaw WHERE attributes->>'email' = $1.
-- Applied to prod with CREATE INDEX CONCURRENTLY (34.6M rows) and marked applied via
-- `prisma migrate resolve --applied`; this file is the history-of-record only.
CREATE INDEX IF NOT EXISTS "User_attributes_email_idx" ON "User" ((attributes->>'email'));
