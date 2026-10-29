-- Complete publication list import: optional bibliographic metadata on a publication (status, month, volume, pages, ISSN, ISBN, category,
-- acceptance date).
--
-- ADDITIVE and metadata-only: nine plain `ALTER TABLE ... ADD COLUMN` statements with a constant default ('' for text, 0 for the month). No
-- table copy, no DROP, no data rewrite. Every EXISTING publication reads back with an empty status ("not stated"), month 0 ("not stated") and
-- empty text, so nothing about any current publication changes. Values are validated in packages/shared (schemas/publication.ts) before the
-- application writes them; the database stores whatever the server hands it.
--
-- status       '' (not stated) | PUBLISHED | ACCEPTED | SUBMITTED
-- pubMonth     0 (not stated) or 1-12; the year stays in the existing `year` column
-- acceptedDate '' or an ISO date YYYY-MM-DD (only ever the date the source states; never inferred)
--
-- ROLL-OUT ORDER: apply this migration BEFORE deploying code that selects or writes these columns. Old code keeps working against the
-- migrated database (it never names the columns; inserts take the defaults). New code against a database WITHOUT the columns answers 500 on
-- the publication routes (fail-closed: nothing is exposed).
-- Turso: applied by the reviewed executor (docs/architecture/turso-migration-executor.md), which accepts exactly these forms of ALTER and pins
-- this file by SHA-256. NOT applied to Production, Preview or any shared remote database.
ALTER TABLE "Publication" ADD COLUMN "status" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "pubMonth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Publication" ADD COLUMN "volume" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "pageStart" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "pageEnd" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "issn" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "isbn" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "acceptedDate" TEXT NOT NULL DEFAULT '';
