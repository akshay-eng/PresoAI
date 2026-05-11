import { NextRequest, NextResponse } from "next/server";
import { buildOpenApiSpec } from "@/lib/openapi-spec";

/**
 * Public OpenAPI 3.1 spec for the v1 REST API. Importable into Postman,
 * Insomnia, Scalar, Stoplight, or any code generator. No auth required so
 * developers can browse before signing up.
 */
export async function GET(request: NextRequest) {
  const baseUrl = new URL(request.url).origin;
  const spec = buildOpenApiSpec(baseUrl);
  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
