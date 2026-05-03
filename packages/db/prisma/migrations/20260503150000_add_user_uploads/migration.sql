-- CreateTable
CREATE TABLE "user_uploads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_uploads_s3Key_key" ON "user_uploads"("s3Key");

-- CreateIndex
CREATE INDEX "user_uploads_userId_createdAt_idx" ON "user_uploads"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "user_uploads" ADD CONSTRAINT "user_uploads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
