-- User-filed support / issue reports. Form is structured (dropdowns); the
-- admin dashboard renders these as cards with status updates.
CREATE TABLE "support_tickets" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "category"    TEXT NOT NULL,
    "severity"    TEXT NOT NULL,
    "area"        TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "projectId"   TEXT,
    "url"         TEXT,
    "userAgent"   TEXT,
    "status"      TEXT NOT NULL DEFAULT 'open',
    "adminNotes"  TEXT,
    "resolvedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_tickets_userId_idx"            ON "support_tickets"("userId");
CREATE INDEX "support_tickets_status_createdAt_idx"  ON "support_tickets"("status", "createdAt");

ALTER TABLE "support_tickets"
  ADD CONSTRAINT "support_tickets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
