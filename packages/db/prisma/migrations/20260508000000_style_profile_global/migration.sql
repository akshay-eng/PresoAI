-- Allow global default style profiles (IBM, ICICI, Wipro) that every user sees.
-- These have NULL userId and isGlobal=true.

-- 1. Drop the old NOT NULL constraint on userId so global profiles can have null owner.
ALTER TABLE "style_profiles" ALTER COLUMN "userId" DROP NOT NULL;

-- 2. Drop the existing FK and recreate it with SET NULL on delete (defensive — if
--    a non-global profile's owner is deleted we keep the row as orphaned rather
--    than cascade-deleting; the API layer filters orphans out anyway).
ALTER TABLE "style_profiles" DROP CONSTRAINT IF EXISTS "style_profiles_userId_fkey";
ALTER TABLE "style_profiles"
  ADD CONSTRAINT "style_profiles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Add isGlobal flag.
ALTER TABLE "style_profiles" ADD COLUMN "isGlobal" BOOLEAN NOT NULL DEFAULT false;

-- 4. Index for fast lookups of global profiles.
CREATE INDEX "style_profiles_isGlobal_idx" ON "style_profiles" ("isGlobal");
