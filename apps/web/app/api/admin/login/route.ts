import { NextRequest, NextResponse } from "next/server";
import { checkAdminCredentials, setAdminCookie } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
    const username = (body.username || "").trim();
    const password = body.password || "";
    if (!username || !password) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }
    if (!checkAdminCredentials(username, password)) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    await setAdminCookie();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
