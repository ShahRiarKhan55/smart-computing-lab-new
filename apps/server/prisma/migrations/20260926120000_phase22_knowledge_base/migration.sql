-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'RESOURCE',
    "visibility" TEXT NOT NULL DEFAULT 'LAB_ONLY',
    "authorId" TEXT,
    "projectId" TEXT,
    "researchAreaId" TEXT,
    "groupId" TEXT,
    "teamMemberId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgeDoc_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDoc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDoc_researchAreaId_fkey" FOREIGN KEY ("researchAreaId") REFERENCES "ResearchArea" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDoc_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ResearchGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeDoc_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "KnowledgeDoc_visibility_updatedAt_idx" ON "KnowledgeDoc"("visibility", "updatedAt");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_projectId_idx" ON "KnowledgeDoc"("projectId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_researchAreaId_idx" ON "KnowledgeDoc"("researchAreaId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_groupId_idx" ON "KnowledgeDoc"("groupId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_teamMemberId_idx" ON "KnowledgeDoc"("teamMemberId");

-- CreateIndex
CREATE INDEX "KnowledgeDoc_authorId_idx" ON "KnowledgeDoc"("authorId");

