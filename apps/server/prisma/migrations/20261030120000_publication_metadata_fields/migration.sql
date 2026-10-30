-- Publication metadata: eight optional fields from the lab's publication-list workbook, each its own column on "Publication":
-- status, listNumber, category, volume, startPage, endPage, month, acceptedDate.
--
-- ADDITIVE and metadata-only: plain `ALTER TABLE ... ADD COLUMN` statements with a constant default ('' for text and the ISO date text, 0 for
-- numbers; 0 / '' mean "not stated"). No table copy, no DROP, no data rewrite. Every EXISTING row reads back as "not stated", so every current
-- publication stays valid and unchanged. The defaults are the constant, NOT NULL forms the project's Turso migration executor accepts.
--
-- ROLL-OUT ORDER: apply this migration BEFORE deploying code that reads these columns. Old code keeps working against the migrated database
-- (it never names the columns; its inserts take the defaults). New code against a database WITHOUT the columns fails every query that loads
-- Publication rows (the publication pages and the pages that embed publications) until the migration is applied.
-- ROLLBACK: redeploy the previous code; the columns can stay unused.
-- NOT applied to Production, Preview or any shared database by the change that added it. Applying it to Turso goes through the reviewed executor
-- (docs/architecture/turso-migration-executor.md), which first needs this file pinned in REVIEWED_MIGRATIONS (a separate, reviewed step).
ALTER TABLE "Publication" ADD COLUMN "status" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "listNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "volume" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Publication" ADD COLUMN "startPage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Publication" ADD COLUMN "endPage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Publication" ADD COLUMN "month" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Publication" ADD COLUMN "acceptedDate" TEXT NOT NULL DEFAULT '';
