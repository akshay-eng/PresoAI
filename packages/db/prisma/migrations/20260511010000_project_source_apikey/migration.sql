-- Track origin of every project so dashboard can hide API/MCP-generated decks.
ALTER TABLE "projects"
  ADD COLUMN "source"   TEXT NOT NULL DEFAULT 'ui',
  ADD COLUMN "apiKeyId" TEXT;

CREATE INDEX "projects_userId_source_createdAt_idx"
  ON "projects"("userId", "source", "createdAt");

CREATE INDEX "projects_apiKeyId_createdAt_idx"
  ON "projects"("apiKeyId", "createdAt");
