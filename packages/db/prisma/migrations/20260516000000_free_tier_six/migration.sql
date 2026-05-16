-- Free tier quota: 1 -> 6 generations per 8h window.
-- Update the column default for new sessions AND backfill existing rows
-- that still have the legacy maxGenerations = 1 so users who already
-- signed up see the new quota immediately.

ALTER TABLE "free_tier_sessions"
  ALTER COLUMN "maxGenerations" SET DEFAULT 6;

UPDATE "free_tier_sessions"
   SET "maxGenerations" = 6
 WHERE "maxGenerations" = 1;
