-- Phase 3C: optional research-profile links on a team member (Google Scholar, ResearchGate, ORCID).
--
-- ADDITIVE and metadata-only: three plain `ALTER TABLE ... ADD COLUMN` statements with a constant empty-string default. No table copy, no
-- DROP, no data rewrite. Every EXISTING row reads back as '' ("no link"), so nothing about any current profile changes. The value written by
-- the application is validated and canonicalised in packages/shared (researchLinks.ts); the database stores whatever the server hands it.
--
-- ROLL-OUT ORDER: apply this migration BEFORE deploying code that selects or writes these columns. Old code keeps working against the
-- migrated database (it never names the columns; inserts take the default ''). New code against a database WITHOUT the columns answers 500 on
-- the team, alumni and member-profile routes (fail-closed: nothing is exposed).
-- Turso: applied by the reviewed executor (docs/architecture/turso-migration-executor.md), which accepts exactly this form of ALTER and pins this
-- file by SHA-256. NOT applied to Production, Preview or any shared remote database.
ALTER TABLE "TeamMember" ADD COLUMN "googleScholarUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TeamMember" ADD COLUMN "researchGateUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TeamMember" ADD COLUMN "orcidUrl" TEXT NOT NULL DEFAULT '';
