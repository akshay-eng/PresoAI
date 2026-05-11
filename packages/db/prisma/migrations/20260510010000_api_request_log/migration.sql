-- Audit log for every inbound v1 API request. Drives admin analytics.
CREATE TABLE "api_request_log" (
    "id"           TEXT        NOT NULL,
    "apiKeyId"     TEXT,
    "userId"       TEXT,
    "method"       TEXT        NOT NULL,
    "endpoint"     TEXT        NOT NULL,
    "statusCode"   INTEGER     NOT NULL,
    "latencyMs"    INTEGER     NOT NULL,
    "jobId"        TEXT,
    "errorCode"    TEXT,
    "ip"           TEXT,
    "userAgent"    TEXT,
    "requestSize"  INTEGER,
    "responseSize" INTEGER,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "api_request_log_apiKeyId_createdAt_idx" ON "api_request_log" ("apiKeyId", "createdAt");
CREATE INDEX "api_request_log_userId_createdAt_idx"  ON "api_request_log" ("userId", "createdAt");
CREATE INDEX "api_request_log_endpoint_createdAt_idx" ON "api_request_log" ("endpoint", "createdAt");
CREATE INDEX "api_request_log_statusCode_idx"        ON "api_request_log" ("statusCode");
CREATE INDEX "api_request_log_createdAt_idx"         ON "api_request_log" ("createdAt");
