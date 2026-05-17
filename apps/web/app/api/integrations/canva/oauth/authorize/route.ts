import { NextRequest, NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth";
import crypto from "crypto";

const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID!;

// Canva scopes needed to upload designs
const SCOPES = [
  "design:content:write",
  "asset:read",
  "asset:write",
].join(" ");

export async function GET(request: NextRequest) {
  try {
    await getRequiredSession();

    if (!CANVA_CLIENT_ID) {
      return NextResponse.json({ error: "Canva not configured" }, { status: 500 });
    }

    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/canva/oauth/callback`;

    // PKCE: code_verifier is a random 43-128 char string
    const codeVerifier = crypto.randomBytes(48).toString("base64url").slice(0, 96);
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    // State carries the verifier (encrypted would be better in prod, but
    // base64 is fine for a short-lived OAuth round-trip in our own infra).
    const state = Buffer.from(JSON.stringify({ codeVerifier })).toString("base64url");

    const params = new URLSearchParams({
      client_id: CANVA_CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `https://www.canva.com/api/oauth/authorize?${params.toString()}`;

    return NextResponse.redirect(authUrl);
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
