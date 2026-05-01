-- pgvector extension for semantic + visual search
CREATE EXTENSION IF NOT EXISTS vector;

-- SourceFile: uploaded PPTX files for the Find feature
CREATE TABLE "source_files" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "slideCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "indexedAt" TIMESTAMP(3),

    CONSTRAINT "source_files_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "source_files_userId_idx" ON "source_files"("userId");

ALTER TABLE "source_files" ADD CONSTRAINT "source_files_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- slide_index: one row per slide in any uploaded source file.
-- NOT exposed via Prisma client — vector ops are accessed via raw SQL from python-agent.
CREATE TABLE "slide_index" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL,
    "sourceFileId" TEXT NOT NULL,
    "slideNumber" INTEGER NOT NULL,
    "thumbnailS3Key" TEXT NOT NULL,
    "slideText" TEXT,
    "ocrText" TEXT,
    "text_tsv" TSVECTOR
        GENERATED ALWAYS AS (
            to_tsvector('english',
                coalesce("slideText", '') || ' ' || coalesce("ocrText", ''))
        ) STORED,
    "text_embedding" vector(768),
    "image_embedding" vector(512),
    "dominant_colors" JSONB,
    "indexedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "slide_index_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "slide_index_source_slide_unique" UNIQUE ("sourceFileId", "slideNumber"),
    CONSTRAINT "slide_index_sourceFileId_fkey"
        FOREIGN KEY ("sourceFileId") REFERENCES "source_files"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "slide_index_userId_idx" ON "slide_index"("userId");
CREATE INDEX "slide_index_text_tsv_idx" ON "slide_index" USING GIN ("text_tsv");
CREATE INDEX "slide_index_text_embedding_idx"
    ON "slide_index" USING ivfflat ("text_embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX "slide_index_image_embedding_idx"
    ON "slide_index" USING ivfflat ("image_embedding" vector_cosine_ops) WITH (lists = 100);
