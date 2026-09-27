-- CreateTable
CREATE TABLE "LabResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '',
    "vendor" TEXT NOT NULL DEFAULT '',
    "identifier" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "environment" TEXT NOT NULL DEFAULT '',
    "metadata" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'LAB_ONLY',
    "ownerId" TEXT,
    "researchAreaId" TEXT,
    "groupId" TEXT,
    "knowledgeDocId" TEXT,
    "publicationId" TEXT,
    "eventId" TEXT,
    "teamMemberId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabResource_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabResource_researchAreaId_fkey" FOREIGN KEY ("researchAreaId") REFERENCES "ResearchArea" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabResource_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ResearchGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabResource_knowledgeDocId_fkey" FOREIGN KEY ("knowledgeDocId") REFERENCES "KnowledgeDoc" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabResource_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabResource_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LabResource_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResourceProject" (
    "resourceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,

    PRIMARY KEY ("resourceId", "projectId"),
    CONSTRAINT "ResourceProject_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "LabResource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResourceProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LabResource_visibility_updatedAt_idx" ON "LabResource"("visibility", "updatedAt");

-- CreateIndex
CREATE INDEX "LabResource_resourceType_idx" ON "LabResource"("resourceType");

-- CreateIndex
CREATE INDEX "LabResource_ownerId_idx" ON "LabResource"("ownerId");

-- CreateIndex
CREATE INDEX "LabResource_researchAreaId_idx" ON "LabResource"("researchAreaId");

-- CreateIndex
CREATE INDEX "LabResource_groupId_idx" ON "LabResource"("groupId");

-- CreateIndex
CREATE INDEX "LabResource_knowledgeDocId_idx" ON "LabResource"("knowledgeDocId");

-- CreateIndex
CREATE INDEX "LabResource_publicationId_idx" ON "LabResource"("publicationId");

-- CreateIndex
CREATE INDEX "LabResource_eventId_idx" ON "LabResource"("eventId");

-- CreateIndex
CREATE INDEX "LabResource_teamMemberId_idx" ON "LabResource"("teamMemberId");

-- CreateIndex
CREATE INDEX "ResourceProject_projectId_idx" ON "ResourceProject"("projectId");

