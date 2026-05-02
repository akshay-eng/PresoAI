// Tiny helpers for traffic tracking — kept in lib so both server (track endpoint
// + admin queries) and the client tracker can stay simple.

export function detectDevice(ua: string | undefined | null): string {
  if (!ua) return "unknown";
  const u = ua.toLowerCase();
  if (/bot|crawler|spider|slurp|facebookexternalhit|preview|pingdom|monitor/.test(u)) return "bot";
  if (/(ipad|tablet|playbook|silk)|(android(?!.*mobile))/.test(u)) return "tablet";
  if (/mobile|iphone|android.*mobile|blackberry|iemobile|opera mini/.test(u)) return "mobile";
  return "desktop";
}

export function summarizeUa(ua: string | undefined | null): string | null {
  if (!ua) return null;
  // Pull a short browser+os summary like "Chrome / macOS" — keep cardinality low.
  let browser = "Other";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = "Safari";
  else if (/opera|opr\//i.test(ua)) browser = "Opera";

  let os = "Other";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  return `${browser} / ${os}`;
}
