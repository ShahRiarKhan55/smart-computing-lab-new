-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "photoUrl" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "pdfUrl" TEXT NOT NULL DEFAULT '',
    "doiUrl" TEXT NOT NULL DEFAULT '',
    "extraUrl" TEXT NOT NULL DEFAULT '',
    "extraLabel" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dateLabel" TEXT NOT NULL,
    "sortDate" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '📣',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ResearchArea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "icon" TEXT NOT NULL DEFAULT '🔬',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HistoryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamMemberId" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HistoryEntry_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublicationAuthor" (
    "publicationId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,

    PRIMARY KEY ("publicationId", "teamMemberId"),
    CONSTRAINT "PublicationAuthor_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublicationAuthor_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NewsAuthor" (
    "newsItemId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,

    PRIMARY KEY ("newsItemId", "teamMemberId"),
    CONSTRAINT "NewsAuthor_newsItemId_fkey" FOREIGN KEY ("newsItemId") REFERENCES "NewsItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NewsAuthor_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_userId_key" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "TeamMember_category_sortOrder_idx" ON "TeamMember"("category", "sortOrder");

-- CreateIndex
CREATE INDEX "Publication_year_idx" ON "Publication"("year");

-- CreateIndex
CREATE INDEX "NewsItem_sortDate_idx" ON "NewsItem"("sortDate");

-- CreateIndex
CREATE INDEX "ResearchArea_sortOrder_idx" ON "ResearchArea"("sortOrder");

-- CreateIndex
CREATE INDEX "HistoryEntry_teamMemberId_idx" ON "HistoryEntry"("teamMemberId");

-- CreateIndex
CREATE INDEX "PublicationAuthor_teamMemberId_idx" ON "PublicationAuthor"("teamMemberId");

-- CreateIndex
CREATE INDEX "NewsAuthor_teamMemberId_idx" ON "NewsAuthor"("teamMemberId");
