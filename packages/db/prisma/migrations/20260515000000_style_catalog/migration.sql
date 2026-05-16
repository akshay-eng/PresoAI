-- Style catalog / marketplace fields. Adds category + isPublic so users
-- can discover styles shared by others, and clonedFromId so we can track
-- when a user clones a public/global style into their own profiles.

ALTER TABLE "style_profiles"
  ADD COLUMN "category"     TEXT,
  ADD COLUMN "isPublic"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "clonedFromId" TEXT;

CREATE INDEX "style_profiles_isPublic_category_status_idx"
  ON "style_profiles"("isPublic", "category", "status");

ALTER TABLE "style_profiles"
  ADD CONSTRAINT "style_profiles_clonedFromId_fkey"
  FOREIGN KEY ("clonedFromId") REFERENCES "style_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
