-- AlterTable
ALTER TABLE "Publication" ADD COLUMN "sourceOrder" INTEGER;

-- CreateTable
CREATE TABLE "PublicationSourceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceKey" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceFile" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRowStart" INTEGER NOT NULL,
    "sourceRowEnd" INTEGER NOT NULL,
    "sourceSeq" INTEGER NOT NULL,
    "disposition" TEXT NOT NULL,
    "publicationId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "rawFields" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicationSourceRecord_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PublicationSourceRecord_sourceKey_key" ON "PublicationSourceRecord"("sourceKey");

-- CreateIndex
CREATE INDEX "PublicationSourceRecord_batchId_sourceSeq_idx" ON "PublicationSourceRecord"("batchId", "sourceSeq");

-- CreateIndex
CREATE INDEX "PublicationSourceRecord_publicationId_idx" ON "PublicationSourceRecord"("publicationId");

