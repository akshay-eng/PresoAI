import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "sf_admin";
const COOKIE_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function adminUsername(): string {
  return process.env.ADMIN_USERNAME || "admin";
}
function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || "Akshay@123";
}
function cookieSecret(): string {
  return (
    process.env.ADMIN_COOKIE_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "dev-only-admin-secret-please-override"
  );
}

function safeEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function sign(payload: string): string {
  return createHmac("sha256", cookieSecret()).update(payload).digest("hex");
}

export function checkAdminCredentials(username: string, password: string): boolean {
  return safeEq(username, adminUsername()) && safeEq(password, adminPassword());
}

export function buildSignedToken(): string {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + COOKIE_TTL_SECONDS * 1000;
  const payload = `admin:${issuedAt}:${expiresAt}`;
  const sig = sign(payload);
  return `${payload}:${sig}`;
}

export function verifyToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split(":");
  if (parts.length !== 4) return false;
  const [role, iat, exp, sig] = parts;
  if (role !== "admin") return false;
  const expNum = parseInt(exp || "0", 10);
  if (!expNum || expNum < Date.now()) return false;
  const expectedSig = sign(`${role}:${iat}:${exp}`);
  return safeEq(sig || "", expectedSig);
}

export async function setAdminCookie() {
  const jar = await cookies();
  // Only mark Secure if the deployment is genuinely HTTPS — opt-in via env.
  // Browsers silently drop Secure cookies on plain HTTP, which would cause
  // a successful POST /admin/login to NOT actually persist the session.
  const useSecure = process.env.ADMIN_COOKIE_SECURE === "true";
  jar.set(COOKIE_NAME, buildSignedToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: useSecure,
    path: "/",
    maxAge: COOKIE_TTL_SECONDS,
  });
}

export async function clearAdminCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function requireAdmin(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!verifyToken(token)) {
    throw new Error("AdminUnauthorized");
  }
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
