CREATE TABLE "download_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presentationId" TEXT,
    "projectId" TEXT,
    "fileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "download_events_createdAt_idx" ON "download_events"("createdAt");
CREATE INDEX "download_events_userId_createdAt_idx" ON "download_events"("userId", "createdAt");

ALTER TABLE "download_events" ADD CONSTRAINT "download_events_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
