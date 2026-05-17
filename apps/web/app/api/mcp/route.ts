/**
 * GET/POST /api/mcp
 *
 * Transparent streaming proxy to the internal mcp-server pod.
 * Cloudflare routes presoai.stallion-ai.in/* to the web NodePort,
 * so we forward MCP traffic here to http://mcp-server:8200/mcp
 * rather than relying on nginx ingress path routing.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MCP_UPSTREAM =
  process.env.MCP_SERVER_URL ?? "http://mcp-server:8200/mcp";

// Headers that must not be forwarded to the upstream.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

async function proxy(req: Request): Promise<Response> {
  const forwarded = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      forwarded.set(key, value);
    }
  });

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  const upstream = await fetch(MCP_UPSTREAM, {
    method: req.method,
    headers: forwarded,
    body: hasBody ? req.body : undefined,
    // @ts-ignore — Node 18+ fetch supports duplex
    duplex: hasBody ? "half" : undefined,
    signal: req.signal,
  });

  // Stream the response body straight through — essential for SSE.
  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      resHeaders.set(key, value);
    }
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

export async function GET(req: Request) {
  return proxy(req);
}

export async function POST(req: Request) {
  return proxy(req);
}

export async function DELETE(req: Request) {
  return proxy(req);
}
