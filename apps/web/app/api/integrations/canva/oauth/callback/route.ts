import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID!;
const CANVA_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET!;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    logger.warn({ error }, "Canva OAuth error returned");
    return NextResponse.redirect(
      new URL(`/dashboard?canva_error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/dashboard?canva_error=missing_params", request.url));
  }

  let codeVerifier: string;
  let presentationId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    codeVerifier = decoded.codeVerifier;
    presentationId = decoded.presentationId;
  } catch {
    return NextResponse.redirect(new URL("/dashboard?canva_error=invalid_state", request.url));
  }

  if (!presentationId) {
    return NextResponse.redirect(new URL("/dashboard?canva_error=missing_presentation", request.url));
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/canva/oauth/callback`;

  // Exchange the authorization code for a token
  const tokenRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CANVA_CLIENT_ID,
      client_secret: CANVA_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    logger.error({ status: tokenRes.status, body: errText }, "Canva token exchange failed");
    return NextResponse.redirect(new URL("/dashboard?canva_error=token_exchange_failed", request.url));
  }

  const { access_token } = await tokenRes.json();

  // Store the token in a short-lived httpOnly cookie — not in the database.
  // The /canva/loading page will use it immediately to upload the PPTX.
  const response = NextResponse.redirect(
    new URL(`/canva/loading?presentationId=${encodeURIComponent(presentationId)}`, request.url)
  );

  response.cookies.set("canva_access_token", access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300, // 5 minutes
    path: "/",
  });

  return response;
}
