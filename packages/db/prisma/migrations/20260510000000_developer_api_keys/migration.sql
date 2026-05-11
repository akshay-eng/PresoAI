-- Developer-facing API keys for our public REST + MCP API. Encrypted at rest.
CREATE TABLE "api_keys" (
    "id"           TEXT        NOT NULL,
    "userId"       TEXT        NOT NULL,
    "name"         TEXT        NOT NULL,
    "prefix"       TEXT        NOT NULL,
    "encryptedKey" TEXT        NOT NULL,
    "last4"        TEXT        NOT NULL,
    "expiresAt"    TIMESTAMP(3),
    "lastUsedAt"   TIMESTAMP(3),
    "revokedAt"    TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "api_keys_userId_idx" ON "api_keys" ("userId");
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" ("prefix");

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
