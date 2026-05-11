-- Per-slide pptxgenjs source for surgical edits without re-running the full pipeline.
ALTER TABLE "presentations" ADD COLUMN "slidesData" JSONB;
ALTER TABLE "presentations" ADD COLUMN "themeSnapshot" JSONB;
