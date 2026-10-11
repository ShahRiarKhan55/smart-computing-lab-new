-- CreateTable
CREATE TABLE "GalleryUploadAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GalleryUploadAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "GalleryUploadAttempt_createdAt_idx" ON "GalleryUploadAttempt"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryUploadAttempt_userId_key_key" ON "GalleryUploadAttempt"("userId", "key");
