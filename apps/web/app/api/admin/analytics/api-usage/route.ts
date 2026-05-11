/**
 * GET /api/admin/analytics/api-usage
 *
 * Aggregates the api_request_log table to surface what's happening on the
 * public v1 REST API: who's calling, what endpoints, how often, with what
 * status codes and latencies. Used by the admin dashboard.
 *
 * Query: ?days=N (7..180, default 30)
 *
 * Response:
 *   {
 *     window: { start, end, days },
 *     totals: { requests, successes, clientErrors, serverErrors, ratelimited, distinctKeys, distinctUsers },
 *     latency: { p50, p95, p99, max, avg },
 *     series: [{ day, requests, errors, p95 }],
 *     topEndpoints: [{ endpoint, count, errorRate }],
 *     topKeys: [{ apiKeyId, name, prefix, last4, userEmail, count, errorRate, lastUsedAt }],
 *     topErrors: [{ errorCode, count }],
 *     statusBreakdown: { ok2xx, redirect3xx, client4xx, server5xx }
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Math.min(
    Math.max(parseInt(request.nextUrl.searchParams.get("days") || "30", 10), 7),
    180,
  );
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1); // include today
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const dayList: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
    dayList.push(d.toISOString().slice(0, 10));
  }

  type SeriesRow = { day: string; requests: number; errors: number; p95: number };
  type EndpointRow = { endpoint: string; count: number; error_rate: number };
  type KeyRow = {
    api_key_id: string | null;
    name: string | null;
    prefix: string | null;
    last4: string | null;
    user_email: string | null;
    count: number;
    error_count: number;
    last_used: string | null;
  };
  type ErrorRow = { error_code: string; count: number };

  const [
    totals,
    latency,
    series,
    statusBreakdown,
    topEndpoints,
    topKeys,
    topErrors,
  ] = await Promise.all([
    // ── totals
    prisma.$queryRaw<Array<{
      requests: number;
      successes: number;
      client_errors: number;
      server_errors: number;
      ratelimited: number;
      distinct_keys: number;
      distinct_users: number;
    }>>`
      SELECT
        COUNT(*)::int                                              AS requests,
        SUM(CASE WHEN "statusCode" BETWEEN 200 AND 299 THEN 1 ELSE 0 END)::int AS successes,
        SUM(CASE WHEN "statusCode" BETWEEN 400 AND 499 THEN 1 ELSE 0 END)::int AS client_errors,
        SUM(CASE WHEN "statusCode" >= 500 THEN 1 ELSE 0 END)::int               AS server_errors,
        SUM(CASE WHEN "statusCode" = 429 THEN 1 ELSE 0 END)::int                AS ratelimited,
        COUNT(DISTINCT "apiKeyId")::int                            AS distinct_keys,
        COUNT(DISTINCT "userId")::int                              AS distinct_users
      FROM api_request_log
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
    `,
    // ── latency percentiles
    prisma.$queryRaw<Array<{ p50: number; p95: number; p99: number; max: number; avg: number }>>`
      SELECT
        COALESCE(percentile_disc(0.5)  WITHIN GROUP (ORDER BY "latencyMs"), 0)::int AS p50,
        COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY "latencyMs"), 0)::int AS p95,
        COALESCE(percentile_disc(0.99) WITHIN GROUP (ORDER BY "latencyMs"), 0)::int AS p99,
        COALESCE(MAX("latencyMs"), 0)::int                                          AS max,
        COALESCE(AVG("latencyMs"), 0)::int                                          AS avg
      FROM api_request_log
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
    `,
    // ── daily series (requests, errors, p95)
    prisma.$queryRaw<SeriesRow[]>`
      SELECT
        to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD')                       AS day,
        COUNT(*)::int                                                                AS requests,
        SUM(CASE WHEN "statusCode" >= 400 THEN 1 ELSE 0 END)::int                    AS errors,
        COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY "latencyMs"), 0)::int  AS p95
      FROM api_request_log
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY 1
      ORDER BY 1
    `,
    // ── status code 2xx/3xx/4xx/5xx
    prisma.$queryRaw<Array<{ bucket: string; count: number }>>`
      SELECT
        CASE
          WHEN "statusCode" BETWEEN 200 AND 299 THEN '2xx'
          WHEN "statusCode" BETWEEN 300 AND 399 THEN '3xx'
          WHEN "statusCode" BETWEEN 400 AND 499 THEN '4xx'
          WHEN "statusCode" >= 500              THEN '5xx'
          ELSE 'other'
        END AS bucket,
        COUNT(*)::int AS count
      FROM api_request_log
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY 1
    `,
    // ── top endpoints
    prisma.$queryRaw<EndpointRow[]>`
      SELECT endpoint,
             COUNT(*)::int AS count,
             COALESCE(
               SUM(CASE WHEN "statusCode" >= 400 THEN 1 ELSE 0 END)::float
                 / NULLIF(COUNT(*), 0),
               0
             )::float AS error_rate
      FROM api_request_log
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
      GROUP BY endpoint
      ORDER BY count DESC
      LIMIT 12
    `,
    // ── top API keys (left join into api_keys + users for human-readable rows)
    prisma.$queryRaw<KeyRow[]>`
      SELECT
        l."apiKeyId"                                AS api_key_id,
        k.name                                      AS name,
        k.prefix                                    AS prefix,
        k.last4                                     AS last4,
        u.email                                     AS user_email,
        COUNT(*)::int                               AS count,
        SUM(CASE WHEN l."statusCode" >= 400 THEN 1 ELSE 0 END)::int AS error_count,
        to_char(MAX(l."createdAt") AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_used
      FROM api_request_log l
      LEFT JOIN api_keys k ON k.id = l."apiKeyId"
      LEFT JOIN users u    ON u.id = l."userId"
      WHERE l."createdAt" >= ${start} AND l."createdAt" < ${end}
        AND l."apiKeyId" IS NOT NULL
      GROUP BY l."apiKeyId", k.name, k.prefix, k.last4, u.email
      ORDER BY count DESC
      LIMIT 10
    `,
    // ── top error codes
    prisma.$queryRaw<ErrorRow[]>`
      SELECT COALESCE("errorCode", 'unknown') AS error_code,
             COUNT(*)::int                     AS count
      FROM api_request_log
      WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
        AND ("errorCode" IS NOT NULL OR "statusCode" >= 400)
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 10
    `,
  ]);

  const t = totals[0] || {
    requests: 0, successes: 0, client_errors: 0, server_errors: 0,
    ratelimited: 0, distinct_keys: 0, distinct_users: 0,
  };
  const lat = latency[0] || { p50: 0, p95: 0, p99: 0, max: 0, avg: 0 };

  // Backfill the day series so the chart has a row for every day in the window.
  const seriesMap = new Map(series.map((r) => [r.day, r]));
  const fullSeries = dayList.map((day) => {
    const row = seriesMap.get(day);
    return {
      day,
      requests: row?.requests ?? 0,
      errors: row?.errors ?? 0,
      p95: row?.p95 ?? 0,
    };
  });

  const statusMap = new Map(statusBreakdown.map((r) => [r.bucket, r.count]));

  return NextResponse.json({
    window: {
      start: start.toISOString(),
      end: end.toISOString(),
      days,
    },
    totals: {
      requests: t.requests,
      successes: t.successes,
      clientErrors: t.client_errors,
      serverErrors: t.server_errors,
      ratelimited: t.ratelimited,
      distinctKeys: t.distinct_keys,
      distinctUsers: t.distinct_users,
    },
    latency: lat,
    series: fullSeries,
    statusBreakdown: {
      ok2xx: statusMap.get("2xx") ?? 0,
      redirect3xx: statusMap.get("3xx") ?? 0,
      client4xx: statusMap.get("4xx") ?? 0,
      server5xx: statusMap.get("5xx") ?? 0,
    },
    topEndpoints: topEndpoints.map((r) => ({
      endpoint: r.endpoint,
      count: r.count,
      errorRate: Number(r.error_rate),
    })),
    topKeys: topKeys.map((r) => ({
      apiKeyId: r.api_key_id,
      name: r.name || "(unknown key)",
      prefix: r.prefix,
      last4: r.last4,
      userEmail: r.user_email,
      count: r.count,
      errorRate: r.count > 0 ? Number(r.error_count) / Number(r.count) : 0,
      lastUsedAt: r.last_used,
    })),
    topErrors: topErrors.map((r) => ({ errorCode: r.error_code, count: r.count })),
  });
}
