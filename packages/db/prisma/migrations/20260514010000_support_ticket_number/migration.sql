-- ITSM-style ticket number for SupportTicket. Sequence-backed so it's
-- monotonically increasing and globally unique. Format: SUP-NNNNNN
-- (zero-padded to 6 digits, e.g. SUP-000042).

CREATE SEQUENCE IF NOT EXISTS support_ticket_seq START 1;

ALTER TABLE "support_tickets"
  ADD COLUMN "ticketNumber" TEXT;

-- Backfill existing rows (in insertion order so older tickets get lower numbers).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM "support_tickets" WHERE "ticketNumber" IS NULL
    ORDER BY "createdAt" ASC
  LOOP
    UPDATE "support_tickets"
       SET "ticketNumber" = 'SUP-' || LPAD(nextval('support_ticket_seq')::text, 6, '0')
     WHERE id = r.id;
  END LOOP;
END $$;

-- Enforce NOT NULL + unique now that every row has a value.
ALTER TABLE "support_tickets"
  ALTER COLUMN "ticketNumber" SET NOT NULL;

CREATE UNIQUE INDEX "support_tickets_ticketNumber_key"
  ON "support_tickets"("ticketNumber");
