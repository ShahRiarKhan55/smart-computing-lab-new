-- CreateTable
CREATE TABLE "OAuthIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicationCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "doi" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL DEFAULT '',
    "year" INTEGER NOT NULL,
    "venue" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "workType" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "publicationId" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" DATETIME,
    "reviewedById" TEXT,
    CONSTRAINT "PublicationCandidate_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicationCandidateResearcher" (
    "candidateId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,

    PRIMARY KEY ("candidateId", "teamMemberId"),
    CONSTRAINT "PublicationCandidateResearcher_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "PublicationCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublicationCandidateResearcher_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncState" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "lockedUntil" DATETIME,
    "lastRunAt" DATETIME,
    "lastStatus" TEXT NOT NULL DEFAULT '',
    "lastSummary" TEXT NOT NULL DEFAULT ''
);

-- AlterTable (additive ADD COLUMN statements, hand-edited from Prisma's generated "RedefineTables"
-- copy/DROP/rename of "TeamMember". Dropping TeamMember on a libSQL/Turso connection can cascade-delete
-- child rows (HistoryEntry, PublicationAuthor, ...) because PRAGMA foreign_keys=OFF is a no-op inside a
-- transaction there. Each ADD COLUMN below is NOT NULL with a constant DEFAULT, which SQLite applies to
-- existing rows without rewriting the table.)
ALTER TABLE "TeamMember" ADD COLUMN "scholarUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TeamMember" ADD COLUMN "researchGateUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TeamMember" ADD COLUMN "orcid" TEXT NOT NULL DEFAULT '';
ALTER TABLE "TeamMember" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "OAuthIdentity_userId_idx" ON "OAuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthIdentity_provider_subject_key" ON "OAuthIdentity"("provider", "subject");

-- CreateIndex
CREATE INDEX "PublicationCandidate_status_idx" ON "PublicationCandidate"("status");

-- CreateIndex
CREATE INDEX "PublicationCandidate_doi_idx" ON "PublicationCandidate"("doi");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationCandidate_provider_externalId_key" ON "PublicationCandidate"("provider", "externalId");

-- CreateIndex
CREATE INDEX "PublicationCandidateResearcher_teamMemberId_idx" ON "PublicationCandidateResearcher"("teamMemberId");
