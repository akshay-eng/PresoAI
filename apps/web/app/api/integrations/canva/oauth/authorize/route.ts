import { NextRequest, NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/auth";
import crypto from "crypto";

const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID!;

const SCOPES = ["design:content:write", "asset:read", "asset:write"].join(" ");

export async function GET(request: NextRequest) {
  try {
    await getRequiredSession();

    if (!CANVA_CLIENT_ID) {
      return NextResponse.json({ error: "Canva not configured" }, { status: 500 });
    }

    const presentationId = request.nextUrl.searchParams.get("presentationId");
    if (!presentationId) {
      return NextResponse.json({ error: "Missing presentationId" }, { status: 400 });
    }

    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/canva/oauth/callback`;

    const codeVerifier = crypto.randomBytes(48).toString("base64url").slice(0, 96);
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

    // Embed both the PKCE verifier and the presentationId in the state
    const state = Buffer.from(JSON.stringify({ codeVerifier, presentationId })).toString("base64url");

    const params = new URLSearchParams({
      client_id: CANVA_CLIENT_ID,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return NextResponse.redirect(`https://www.canva.com/api/oauth/authorize?${params.toString()}`);
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
