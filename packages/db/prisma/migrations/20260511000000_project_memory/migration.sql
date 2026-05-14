-- Per-project knowledge graph. 1-to-1 with projects. Accumulates entities,
-- decisions, prior outlines, edits, preferences, and an LLM-rolled narrative.
CREATE TABLE "project_memory" (
    "id"          TEXT NOT NULL,
    "projectId"   TEXT NOT NULL,
    "entities"    JSONB NOT NULL DEFAULT '[]'::jsonb,
    "decisions"   JSONB NOT NULL DEFAULT '[]'::jsonb,
    "outlines"    JSONB NOT NULL DEFAULT '[]'::jsonb,
    "edits"       JSONB NOT NULL DEFAULT '[]'::jsonb,
    "preferences" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "narrative"   TEXT NOT NULL DEFAULT '',
    "version"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_memory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_memory_projectId_key" ON "project_memory"("projectId");

ALTER TABLE "project_memory"
  ADD CONSTRAINT "project_memory_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
