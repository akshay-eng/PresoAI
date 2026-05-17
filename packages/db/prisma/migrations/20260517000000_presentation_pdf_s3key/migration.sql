-- Add pdfS3Key column to presentations table.
-- Stores the S3 key of the PDF version generated alongside the PPTX.
-- Populated by the node-worker during thumbnail generation (LibreOffice converts
-- PPTX→PDF as an intermediate step, so we save that PDF for free).

ALTER TABLE "presentations"
  ADD COLUMN IF NOT EXISTS "pdfS3Key" TEXT;
