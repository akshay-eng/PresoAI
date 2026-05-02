// Coupon codes — server-side only. Anyone holding a code gets unlimited
// generations using the server's default Gemini key, bypassing the free
// tier rate limit. Keep this list short and don't expose it to the client.

const VALID_COUPONS = new Set<string>([
  "WIPRO123",
  "TECHM123",
  "IWANTITFREE",
]);

export function normalizeCoupon(code: string): string {
  return code.trim().toUpperCase();
}

export function isValidCoupon(code: string): boolean {
  return VALID_COUPONS.has(normalizeCoupon(code));
}
