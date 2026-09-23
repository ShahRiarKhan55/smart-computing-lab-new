-- Phase 8: platform foundation (ADDITIVE ONLY).
--
-- * 22 new tables (research domain, events, files/gallery, forum, messaging,
--   notifications, audit log, translations). Nothing references them yet.
-- * 3 existing tables gain a `visibility` column (DEFAULT 'PUBLIC', so every
--   existing row keeps its current audience); NewsItem also gains an optional
--   `projectId`.
--
-- HAND-EDITED relative to `prisma migrate dev` output, on purpose:
--   1. Prisma emits "RedefineTables" (create new_X / copy / DROP TABLE X /
--      rename) for those column additions. That is only safe while
--      PRAGMA foreign_keys=OFF actually takes effect (SQLite silently ignores
--      it inside a transaction); if it does not, dropping a parent table
--      cascade-deletes its join rows (PublicationAuthor, NewsAuthor). In this
--      environment Prisma's version was tested and did preserve the data, but
--      SQLite can add a column with a constant default in place, which needs no
--      such assumption: plain ALTER TABLE ... ADD COLUMN, no copy, no drop.
--   2. ForumReaction and ForumMention get a CHECK so exactly one of
--      postId/commentId is set (Prisma cannot express CHECK constraints).
--      A future migration that rebuilds either table must re-add it.

-- CreateTable
CREATE TABLE "ResearchGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'LAB_ONLY',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "groupId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',

    PRIMARY KEY ("groupId", "teamMemberId"),
    CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ResearchGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupMember_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "visibility" TEXT NOT NULL DEFAULT 'LAB_ONLY',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "groupId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResearchProject_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ResearchGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',

    PRIMARY KEY ("projectId", "teamMemberId"),
    CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMember_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectArea" (
    "projectId" TEXT NOT NULL,
    "researchAreaId" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "researchAreaId"),
    CONSTRAINT "ProjectArea_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectArea_researchAreaId_fkey" FOREIGN KEY ("researchAreaId") REFERENCES "ResearchArea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectPublication" (
    "projectId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "publicationId"),
    CONSTRAINT "ProjectPublication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectPublication_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResearcherArea" (
    "teamMemberId" TEXT NOT NULL,
    "researchAreaId" TEXT NOT NULL,

    PRIMARY KEY ("teamMemberId", "researchAreaId"),
    CONSTRAINT "ResearcherArea_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearcherArea_researchAreaId_fkey" FOREIGN KEY ("researchAreaId") REFERENCES "ResearchArea" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "visibility" TEXT NOT NULL DEFAULT 'LAB_ONLY',
    "projectId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'LAB_ONLY',
    "ownerId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GalleryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileId" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'LAB_LIFE',
    "takenAt" DATETIME,
    "eventId" TEXT,
    "projectId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GalleryItem_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GalleryItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "GalleryItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForumCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'LAB_ONLY',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ForumPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "authorId" TEXT,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" DATETIME,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ForumPost_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ForumCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ForumPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ForumPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForumPostRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "editorId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForumPostRevision_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForumPostRevision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForumComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "authorId" TEXT,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "editedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ForumComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForumComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ForumComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ForumComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ForumReaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'LIKE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForumReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForumReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForumReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ForumComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForumReaction_one_target" CHECK (("postId" IS NULL) <> ("commentId" IS NULL))
);

-- CreateTable
CREATE TABLE "ForumMention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mentionedUserId" TEXT NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ForumMention_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForumMention_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ForumPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForumMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ForumComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ForumMention_one_target" CHECK (("postId" IS NULL) <> ("commentId" IS NULL))
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'DIRECT',
    "directKey" TEXT,
    "lastMessageAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" DATETIME,
    "archivedAt" DATETIME,

    PRIMARY KEY ("conversationId", "userId"),
    CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT,
    "body" TEXT NOT NULL,
    "editedAt" DATETIME,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "targetPath" TEXT NOT NULL DEFAULT '',
    "payload" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "actorEmail" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Translation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable (hand-written; see header)
ALTER TABLE "Publication" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "ResearchArea" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "NewsItem" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "NewsItem" ADD COLUMN "projectId" TEXT REFERENCES "ResearchProject" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "NewsItem_projectId_idx" ON "NewsItem"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchGroup_slug_key" ON "ResearchGroup"("slug");

-- CreateIndex
CREATE INDEX "ResearchGroup_sortOrder_idx" ON "ResearchGroup"("sortOrder");

-- CreateIndex
CREATE INDEX "GroupMember_teamMemberId_idx" ON "GroupMember"("teamMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProject_slug_key" ON "ResearchProject"("slug");

-- CreateIndex
CREATE INDEX "ResearchProject_groupId_idx" ON "ResearchProject"("groupId");

-- CreateIndex
CREATE INDEX "ResearchProject_visibility_sortOrder_idx" ON "ResearchProject"("visibility", "sortOrder");

-- CreateIndex
CREATE INDEX "ProjectMember_teamMemberId_idx" ON "ProjectMember"("teamMemberId");

-- CreateIndex
CREATE INDEX "ProjectArea_researchAreaId_idx" ON "ProjectArea"("researchAreaId");

-- CreateIndex
CREATE INDEX "ProjectPublication_publicationId_idx" ON "ProjectPublication"("publicationId");

-- CreateIndex
CREATE INDEX "ResearcherArea_researchAreaId_idx" ON "ResearcherArea"("researchAreaId");

-- CreateIndex
CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");

-- CreateIndex
CREATE INDEX "Event_projectId_idx" ON "Event"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_storageKey_key" ON "StoredFile"("storageKey");

-- CreateIndex
CREATE INDEX "StoredFile_entityType_entityId_idx" ON "StoredFile"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "StoredFile_ownerId_idx" ON "StoredFile"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryItem_fileId_key" ON "GalleryItem"("fileId");

-- CreateIndex
CREATE INDEX "GalleryItem_eventId_idx" ON "GalleryItem"("eventId");

-- CreateIndex
CREATE INDEX "GalleryItem_projectId_idx" ON "GalleryItem"("projectId");

-- CreateIndex
CREATE INDEX "GalleryItem_category_sortOrder_idx" ON "GalleryItem"("category", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ForumCategory_slug_key" ON "ForumCategory"("slug");

-- CreateIndex
CREATE INDEX "ForumCategory_sortOrder_idx" ON "ForumCategory"("sortOrder");

-- CreateIndex
CREATE INDEX "ForumPost_categoryId_pinned_lastActivityAt_idx" ON "ForumPost"("categoryId", "pinned", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ForumPost_authorId_idx" ON "ForumPost"("authorId");

-- CreateIndex
CREATE INDEX "ForumPost_projectId_idx" ON "ForumPost"("projectId");

-- CreateIndex
CREATE INDEX "ForumPostRevision_postId_createdAt_idx" ON "ForumPostRevision"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumComment_postId_createdAt_idx" ON "ForumComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "ForumComment_parentId_idx" ON "ForumComment"("parentId");

-- CreateIndex
CREATE INDEX "ForumComment_authorId_idx" ON "ForumComment"("authorId");

-- CreateIndex
CREATE INDEX "ForumReaction_postId_idx" ON "ForumReaction"("postId");

-- CreateIndex
CREATE INDEX "ForumReaction_commentId_idx" ON "ForumReaction"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumReaction_userId_postId_kind_key" ON "ForumReaction"("userId", "postId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ForumReaction_userId_commentId_kind_key" ON "ForumReaction"("userId", "commentId", "kind");

-- CreateIndex
CREATE INDEX "ForumMention_postId_idx" ON "ForumMention"("postId");

-- CreateIndex
CREATE INDEX "ForumMention_commentId_idx" ON "ForumMention"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumMention_mentionedUserId_postId_key" ON "ForumMention"("mentionedUserId", "postId");

-- CreateIndex
CREATE UNIQUE INDEX "ForumMention_mentionedUserId_commentId_key" ON "ForumMention"("mentionedUserId", "commentId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "ConversationParticipant_userId_idx" ON "ConversationParticipant"("userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_actorId_idx" ON "Notification"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Translation_entityType_entityId_idx" ON "Translation"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Translation_entityType_entityId_locale_field_key" ON "Translation"("entityType", "entityId", "locale", "field");

