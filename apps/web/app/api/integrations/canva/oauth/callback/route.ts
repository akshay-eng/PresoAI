import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { logger } from "@/lib/logger";

const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID!;
const CANVA_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET!;

export async function GET(request: NextRequest) {
  try {
    const session = await getRequiredSession();
    const { searchParams } = request.nextUrl;

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      logger.warn({ error }, "Canva OAuth error returned");
      return NextResponse.redirect(
        new URL(`/settings?canva_error=${encodeURIComponent(error)}`, request.url)
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(new URL("/settings?canva_error=missing_params", request.url));
    }

    // Recover the PKCE code_verifier from the state
    let codeVerifier: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
      codeVerifier = decoded.codeVerifier;
    } catch {
      return NextResponse.redirect(new URL("/settings?canva_error=invalid_state", request.url));
    }

    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/canva/oauth/callback`;

    // Exchange the authorization code for tokens
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
      return NextResponse.redirect(new URL("/settings?canva_error=token_exchange_failed", request.url));
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

    // Fetch the Canva user ID to use as providerAccountId
    const userRes = await fetch("https://api.canva.com/rest/v1/users/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const canvaUserId = userRes.ok
      ? (await userRes.json())?.team_user?.user_id ?? "unknown"
      : "unknown";

    // Upsert into OAuthAccount (reuse existing model)
    await prisma.oAuthAccount.upsert({
      where: { provider_providerAccountId: { provider: "canva", providerAccountId: canvaUserId } },
      create: {
        userId: session.user.id,
        provider: "canva",
        providerAccountId: canvaUserId,
        accessToken: access_token,
        refreshToken: refresh_token ?? null,
        expiresAt,
        scope: tokenData.scope ?? null,
      },
      update: {
        userId: session.user.id,
        accessToken: access_token,
        refreshToken: refresh_token ?? null,
        expiresAt,
        scope: tokenData.scope ?? null,
      },
    });

    logger.info({ userId: session.user.id, canvaUserId }, "Canva OAuth connected");

    return NextResponse.redirect(new URL("/settings?canva_connected=1", request.url));
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }
    logger.error({ err: (err as Error).message }, "Canva OAuth callback error");
    return NextResponse.redirect(new URL("/settings?canva_error=internal", request.url));
  }
}
